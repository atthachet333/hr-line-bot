/**
 * HR LINE Bot — Google Apps Script web app (REFERENCE IMPLEMENTATION).
 *
 * Deploy this as a Web App (Execute as: Me, Access: Anyone with the URL) and put
 * the deployment URL into GOOGLE_APPS_SCRIPT_URL in the Next.js app.
 *
 * Every action returns the standard JSON contract:
 *   { success: boolean, code: string, message?: string, data?: object }
 *
 * Actions: getBalance | checkin | checkout | transitionLeaveStatus
 *
 * The transitionLeaveStatus action uses LockService.getScriptLock() so that only
 * the FIRST transition out of PENDING succeeds even under concurrent approvals.
 */

var SHEET_LEAVE_REQUESTS = 'LeaveRequests';
var SHEET_ATTENDANCE = 'Attendance';
var TZ = 'Asia/Bangkok';

function doGet(e) {
  return handle(e);
}
function doPost(e) {
  return handle(e);
}

function handle(e) {
  var params = (e && e.parameter) || {};
  // Allow JSON POST bodies too.
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      for (var k in body) if (params[k] === undefined) params[k] = body[k];
    } catch (err) {
      /* ignore, use query params */
    }
  }

  var action = params.action;
  try {
    switch (action) {
      case 'getBalance':
        return json(getBalance(params));
      case 'checkin':
        return json(recordAttendance(params, 'checkin'));
      case 'checkout':
        return json(recordAttendance(params, 'checkout'));
      case 'transitionLeaveStatus':
        return json(transitionLeaveStatus(params));
      default:
        return json({ success: false, code: 'UNKNOWN_ACTION', message: 'action ไม่ถูกต้อง', data: null });
    }
  } catch (err) {
    return json({ success: false, code: 'INTERNAL_ERROR', message: String(err), data: null });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function headerMap(sheet) {
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < header.length; i++) map[header[i]] = i;
  return map;
}

/**
 * ATOMIC transition out of PENDING. Uses a script lock to serialise writers.
 */
function transitionLeaveStatus(params) {
  var requestId = params.requestId;
  var desiredStatus = params.desiredStatus; // APPROVED | REJECTED
  var actorName = params.actorName || '';
  var reason = params.reason || '';
  if (!requestId || (desiredStatus !== 'APPROVED' && desiredStatus !== 'REJECTED')) {
    return { success: false, code: 'VALIDATION_ERROR', message: 'พารามิเตอร์ไม่ถูกต้อง', data: null };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000); // wait up to 20s
  try {
    var ss = SpreadsheetApp.openById(getSpreadsheetId());
    var sheet = ss.getSheetByName(SHEET_LEAVE_REQUESTS);
    var map = headerMap(sheet);
    var data = sheet.getDataRange().getValues();
    var nowIso = new Date().toISOString();

    for (var r = 1; r < data.length; r++) {
      if (String(data[r][map['requestId']]) === String(requestId)) {
        var currentStatus = String(data[r][map['status']] || '');
        if (currentStatus !== 'PENDING') {
          return {
            success: false,
            code: 'ALREADY_PROCESSED',
            message: 'คำขอถูกดำเนินการไปแล้ว',
            data: { requestId: requestId, currentStatus: currentStatus },
          };
        }
        var rowNumber = r + 1;
        setCell(sheet, rowNumber, map, 'status', desiredStatus);
        setCell(sheet, rowNumber, map, 'updatedAt', nowIso);
        if (desiredStatus === 'APPROVED') {
          setCell(sheet, rowNumber, map, 'approvedBy', actorName);
          setCell(sheet, rowNumber, map, 'approvedAt', nowIso);
        } else {
          setCell(sheet, rowNumber, map, 'rejectedBy', actorName);
          setCell(sheet, rowNumber, map, 'rejectedAt', nowIso);
          setCell(sheet, rowNumber, map, 'rejectedReason', reason);
        }
        SpreadsheetApp.flush();
        return {
          success: true,
          code: 'STATUS_UPDATED',
          message: 'อัปเดตสถานะสำเร็จ',
          data: {
            requestId: requestId,
            previousStatus: 'PENDING',
            currentStatus: desiredStatus,
            approvedBy: desiredStatus === 'APPROVED' ? actorName : '',
            approvedAt: desiredStatus === 'APPROVED' ? nowIso : '',
            rejectedBy: desiredStatus === 'REJECTED' ? actorName : '',
            rejectedAt: desiredStatus === 'REJECTED' ? nowIso : '',
            rejectedReason: desiredStatus === 'REJECTED' ? reason : '',
          },
        };
      }
    }
    return { success: false, code: 'REQUEST_NOT_FOUND', message: 'ไม่พบคำขอ', data: { requestId: requestId } };
  } finally {
    lock.releaseLock();
  }
}

function setCell(sheet, rowNumber, map, col, value) {
  if (map[col] === undefined) return;
  sheet.getRange(rowNumber, map[col] + 1).setValue(value);
}

function getSpreadsheetId() {
  // If bound to a spreadsheet, prefer the active one; otherwise set an id here.
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active.getId();
  return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
}

/**
 * getBalance — replace the body with your existing balance logic. Must return
 * the standard contract with data holding the profile + balances.
 */
function getBalance(params) {
  var userId = params.userId;
  if (!userId) return { success: false, code: 'VALIDATION_ERROR', message: 'userId is required', data: null };
  // TODO: look up the employee + balances by userId in your Employees sheet.
  // Returning a not-found contract by default so nothing is faked.
  return { success: false, code: 'EMPLOYEE_NOT_FOUND', message: 'ไม่พบข้อมูลพนักงาน', data: null };
}

/**
 * Attendance with duplicate protection keyed by userId + date + type.
 */
function recordAttendance(params, type) {
  var userId = params.userId || params.displayName;
  if (!userId) return { success: false, code: 'VALIDATION_ERROR', message: 'missing user', data: null };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.openById(getSpreadsheetId());
    var sheet = ss.getSheetByName(SHEET_ATTENDANCE) || ss.insertSheet(SHEET_ATTENDANCE);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['timestamp', 'date', 'userId', 'displayName', 'type', 'time', 'lat', 'lng', 'summary', 'clientRequestId']);
    }
    var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
    var values = sheet.getDataRange().getValues();
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][2]) === String(userId) && String(values[r][1]) === today && String(values[r][4]) === type) {
        return {
          success: false,
          code: type === 'checkin' ? 'ALREADY_CHECKED_IN' : 'ALREADY_CHECKED_OUT',
          message: type === 'checkin' ? 'วันนี้คุณเช็กอินแล้ว' : 'วันนี้คุณเช็กเอาต์แล้ว',
          data: null,
        };
      }
    }
    if (type === 'checkout') {
      var hasCheckin = false;
      for (var i = 1; i < values.length; i++) {
        if (String(values[i][2]) === String(userId) && String(values[i][1]) === today && String(values[i][4]) === 'checkin') hasCheckin = true;
      }
      if (!hasCheckin) {
        return { success: false, code: 'NOT_CHECKED_IN', message: 'ยังไม่ได้เช็กอินวันนี้', data: null };
      }
    }
    sheet.appendRow([
      new Date().toISOString(),
      today,
      userId,
      params.displayName || '',
      type,
      params.time || '',
      params.lat || '',
      params.lng || '',
      params.summary || '',
      params.clientRequestId || '',
    ]);
    SpreadsheetApp.flush();
    return {
      success: true,
      code: type === 'checkin' ? 'CHECK_IN_RECORDED' : 'CHECK_OUT_RECORDED',
      message: type === 'checkin' ? 'บันทึกเวลาเข้างานสำเร็จ' : 'บันทึกเวลาออกงานสำเร็จ',
      data: { date: today, type: type },
    };
  } finally {
    lock.releaseLock();
  }
}
