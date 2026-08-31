import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { maskId } from '@/lib/utils/mask';
import { readJsonBody, bearerToken } from '@/lib/http/guards';
import { ok, fail } from '@/lib/http/respond';
import { rateLimit } from '@/lib/rate-limit';
import { AuthenticationError, BusinessRuleError, ConflictError, RateLimitError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { verifyIdentity } from '@/lib/line/identity';
import { validateLeaveInput } from '@/lib/validation/leave';
import { findByLineUserId } from '@/lib/repositories/employee-repository';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';
import * as auditLog from '@/lib/repositories/audit-log-repository';
import { loadHolidays } from '@/lib/repositories/holiday-repository';
import { computeLeaveDays } from '@/lib/services/leave-calculation-service';
import { assertSufficientBalance } from '@/lib/services/leave-balance-service';
import { sendManagerNotification } from '@/lib/services/notification-service';
import { generateRequestId } from '@/lib/utils/request-id';
import { nowIso } from '@/lib/utils/datetime';
import { validateEvidence, type ValidatedEvidence } from '@/lib/evidence/validate';
import { saveEvidence, deleteEvidence, isValidEvidenceEmployeeId } from '@/lib/evidence/storage';
import {
  emptyEvidenceMetadata,
  MAX_EVIDENCE_FILES,
  type EvidenceMetadata,
  type LeaveEvidenceRecord,
} from '@/lib/evidence/types';
import * as evidenceRepo from '@/lib/repositories/leave-evidence-repository';
import type { LeaveRequest } from '@/lib/domain/leave-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/leave';
const RATE_LIMIT = 10; // per user
const RATE_WINDOW_MS = 60_000;

interface ParsedRequest {
  fields: Record<string, unknown>;
  idToken?: string;
  accessToken?: string;
  evidenceFiles: { buffer: Uint8Array; fileName: string; mime: string }[];
}

/**
 * Read the request as multipart/form-data (with optional evidence) OR JSON (for
 * older clients). Enforces the size cap before buffering a large file.
 */
async function parseRequest(req: Request, maxBytes: number): Promise<ParsedRequest> {
  const contentType = (req.headers.get('content-type') || '').toLowerCase();
  const headerToken = bearerToken(req);

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const fields: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;

    // `evidenceFiles` is the multi-file field. Keep accepting legacy `evidence`
    // so an older LIFF client can still submit during a rolling deployment.
    const uploaded = [...form.getAll('evidenceFiles'), ...form.getAll('evidence')]
      .filter((value): value is File => typeof value !== 'string' && value.size > 0);
    if (uploaded.length > MAX_EVIDENCE_FILES) {
      throw new BusinessRuleError('TOO_MANY_EVIDENCE_FILES', `แนบหลักฐานได้สูงสุด ${MAX_EVIDENCE_FILES} ไฟล์`, 400);
    }
    const totalBytes = uploaded.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > maxBytes * MAX_EVIDENCE_FILES) {
      throw new BusinessRuleError('EVIDENCE_TOTAL_TOO_LARGE', 'ขนาดไฟล์หลักฐานรวมเกิน 50 MB', 413);
    }
    const evidenceFiles: ParsedRequest['evidenceFiles'] = [];
    for (const file of uploaded) {
      if (file.size > maxBytes) {
        throw new BusinessRuleError('EVIDENCE_TOO_LARGE', 'ไฟล์หลักฐานมีขนาดใหญ่เกิน 10 MB', 413);
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      evidenceFiles.push({ buffer: buf, fileName: file.name || 'evidence', mime: file.type || '' });
    }
    return {
      fields,
      idToken: typeof fields.idToken === 'string' ? fields.idToken : undefined,
      accessToken: (typeof fields.accessToken === 'string' ? fields.accessToken : undefined) ?? headerToken,
      evidenceFiles,
    };
  }

  const body = await readJsonBody<Record<string, unknown>>(req);
  return {
    fields: body,
    idToken: typeof body.idToken === 'string' ? body.idToken : undefined,
    accessToken: (typeof body.accessToken === 'string' ? body.accessToken : undefined) ?? headerToken,
    evidenceFiles: [],
  };
}

function evidenceErrorStatus(code: string): number {
  if (code === 'EVIDENCE_TOO_LARGE') return 413;
  if (code === 'UNSUPPORTED_EVIDENCE_TYPE') return 415;
  return 400; // EVIDENCE_CONTENT_MISMATCH
}

export async function POST(req: Request): Promise<NextResponse> {
  const correlationId = correlationIdFrom(req);
  const startedAt = Date.now();
  const maxBytes = env.leaveEvidenceMaxBytes();
  try {
    const parsed = await parseRequest(req, maxBytes);

    // 1. Verify identity from the LINE token (never trust browser identity).
    const identity = await verifyIdentity({ idToken: parsed.idToken, accessToken: parsed.accessToken });
    if (!identity.ok) {
      throw new AuthenticationError('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดจากแอป LINE อีกครั้ง');
    }
    const lineUserId = identity.identity.lineUserId;

    const rl = rateLimit(`leave:${lineUserId}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) throw new RateLimitError('มีการส่งคำขอบ่อยเกินไป กรุณารอสักครู่');

    // 2. Validate request details.
    const validated = validateLeaveInput(parsed.fields);
    if (!validated.ok) {
      const { ValidationError } = await import('@/lib/errors');
      throw new ValidationError(validated.error);
    }
    const input = validated.value;

    // 3. Resolve the employee server-side (identity from the Employees sheet only).
    const employee = await findByLineUserId(lineUserId);
    if (!employee) {
      logger.warn('leave_employee_not_linked', {
        route: ROUTE,
        correlationId,
        code: 'EMPLOYEE_NOT_LINKED',
        verifiedLineUserIdMasked: maskId(lineUserId),
        employeeLookupResult: 'not_found',
      });
      throw new BusinessRuleError(
        'EMPLOYEE_NOT_LINKED',
        'บัญชี LINE นี้ยังไม่ได้เชื่อมกับข้อมูลพนักงาน กรุณาผูกบัญชีก่อนส่งคำขอลา',
        403,
      );
    }

    // 4. Idempotency: a duplicate never re-creates a row or re-saves a file.
    const existing = await leaveRepo.findByIdempotencyKey(lineUserId, input.clientRequestId);
    if (existing) {
      const r = existing.request;
      return ok(
        correlationId,
        'DUPLICATE_REQUEST',
        {
          requestId: r.requestId,
          status: r.status,
          managerNotified: r.managerNotificationStatus === 'SENT',
          retryable: r.managerNotificationStatus !== 'SENT',
        },
        { message: 'คำขอนี้ถูกส่งไปแล้ว' },
      );
    }

    // 5. Validate the OPTIONAL evidence up-front (before any row/file is created).
    //    A missing file is always fine — evidence never gates the request.
    const validatedEvidence: ValidatedEvidence[] = [];
    for (const evidence of parsed.evidenceFiles) {
      const v = validateEvidence({
        buffer: evidence.buffer,
        fileName: evidence.fileName,
        claimedMime: evidence.mime,
        maxBytes,
      });
      if (!v.ok) {
        throw new BusinessRuleError(v.code, evidenceErrorMessage(v.code), evidenceErrorStatus(v.code));
      }
      validatedEvidence.push(v.value);
    }

    // 6. Server-side leave-day calculation (never trust client totalDays).
    const holidays = await loadHolidays();
    const totalDays = computeLeaveDays(input.startDate, input.endDate, {
      countWeekends: env.leaveCountWeekends(),
      holidays,
    });
    if (totalDays < 1) {
      throw new BusinessRuleError('VALIDATION_ERROR', 'ช่วงวันที่เลือกไม่มีวันทำงานที่นับเป็นวันลา');
    }

    // 7. Overlap check — only the SAME employee's own active requests block
    //    (keyed by canonical employeeId / verified LINE id; never another person).
    const overlap = await leaveRepo.findOverlapping(lineUserId, employee.employeeId, input.startDate, input.endDate);
    if (overlap) {
      throw new ConflictError('มีคำขอลาในช่วงวันที่ดังกล่าวแล้ว', 'OVERLAPPING_LEAVE_REQUEST', `overlaps ${overlap.requestId}`);
    }

    // 8. Balance check (best-effort).
    const balance = await assertSufficientBalance(lineUserId, input.leaveType, totalDays);
    const balanceWarning = balance.checked === false && balance.skipped;
    if (balanceWarning) {
      logger.warn('leave_balance_check_skipped', {
        correlationId, route: ROUTE, actorType: 'employee', result: 'skipped',
        code: balance.skipReason, detail: `bucket=${balance.bucket} type=${input.leaveType}`,
      });
    }

    // 9. Persist the PENDING row (evidence NONE for now).
    const managerTarget = env.managerGroupId() || env.managerUserIds()[0] || '';
    const requestId = generateRequestId();
    const createdAt = nowIso();
    const record: LeaveRequest = {
      requestId,
      clientRequestId: input.clientRequestId,
      employeeLineUserId: lineUserId,
      employeeId: employee.employeeId,
      employeeName: employee.name,
      position: employee.position,
      department: employee.department,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      totalDays,
      reason: input.reason,
      managerLineUserId: employee.managerLineUserId || managerTarget,
      status: 'PENDING',
      approvedBy: '', approvedByLineUserId: '', approvedAt: '',
      rejectedBy: '', rejectedByLineUserId: '', rejectedAt: '', rejectedReason: '',
      approvalSource: '',
      createdAt,
      updatedAt: createdAt,
      managerNotificationStatus: 'NOT_STARTED',
      managerNotificationAttempts: 0,
      managerNotificationLastAttemptAt: '',
      managerNotificationError: '',
      employeeNotificationStatus: 'NOT_STARTED',
      employeeNotificationAttempts: 0,
      employeeNotificationLastAttemptAt: '',
      employeeNotificationError: '',
      ...emptyEvidenceMetadata(),
    };
    await leaveRepo.create(record);
    await auditLog.append({
      requestId, action: 'CREATE', actorLineUserId: lineUserId, actorName: employee.name,
      toStatus: 'PENDING', detail: `${input.leaveType} ${input.startDate}..${input.endDate} (${totalDays}d)`,
    });
    if (balanceWarning) {
      await auditLog.append({
        requestId, action: 'LEAVE_BALANCE_CHECK_SKIPPED', actorLineUserId: lineUserId, actorName: employee.name,
        detail: `reason=${balance.skipReason} bucket=${balance.bucket}`,
      });
    }

    // 10. Promote the evidence file (atomic) + write metadata. Failure here NEVER
    //     fails the request — the row stays and is retryable (status UPLOAD_FAILED).
    let evidenceMeta: EvidenceMetadata = emptyEvidenceMetadata();
    if (validatedEvidence.length > 0) {
      evidenceMeta = await attachEvidenceFiles(requestId, employee.employeeId, validatedEvidence, correlationId);
      try {
        // Legacy columns are a compatibility summary only. The authoritative
        // multi-file rows have already been committed, so a summary-write
        // failure must not turn an otherwise valid leave into a failed request.
        await leaveRepo.setEvidenceMetadata(requestId, evidenceMeta);
      } catch (error) {
        logger.warn('evidence_legacy_summary_failed', {
          correlationId, route: ROUTE, leaveRequestId: requestId, result: 'error',
          detail: error instanceof Error ? error.message.slice(0, 120) : 'error',
        });
      }
    }

    // 11. Notify manager (Flex reflects the evidence state) and return the result.
    const recordForNotify: LeaveRequest = { ...record, ...evidenceMeta };
    const notify = await sendManagerNotification(recordForNotify, correlationId);
    logger.info('leave_created', {
      correlationId, route: ROUTE, leaveRequestId: requestId, actorType: 'employee',
      result: 'ok', durationMs: Date.now() - startedAt,
    });

    const data = {
      requestId,
      status: 'PENDING' as const,
      managerNotified: notify.ok,
      balanceChecked: !balanceWarning,
      evidenceStatus: evidenceMeta.evidenceStatus,
      evidenceCount: evidenceMeta.evidenceStatus === 'AVAILABLE' ? validatedEvidence.length : 0,
      ...(notify.ok ? {} : { retryable: true }),
    };
    if (notify.ok) {
      return ok(correlationId, 'LEAVE_REQUEST_CREATED', data, { status: 201 });
    }
    await auditLog.append({ requestId, action: 'NOTIFY_MANAGER_FAILED', detail: notify.error ?? '' });
    return ok(correlationId, 'LEAVE_REQUEST_CREATED_NOTIFY_FAILED', data, {
      status: 202,
      message: 'บันทึกคำขอแล้ว แต่แจ้งเตือนหัวหน้าไม่สำเร็จ ระบบจะติดตามให้ภายหลัง',
    });
  } catch (err) {
    return fail(err, correlationId, { route: ROUTE });
  }
}

function evidenceErrorMessage(code: string): string {
  switch (code) {
    case 'EVIDENCE_TOO_LARGE':
      return 'ไฟล์หลักฐานมีขนาดใหญ่เกิน 10 MB';
    case 'UNSUPPORTED_EVIDENCE_TYPE':
      return 'รองรับเฉพาะไฟล์ JPG, PNG, WEBP หรือ PDF เท่านั้น';
    default:
      return 'ไฟล์หลักฐานไม่ถูกต้อง กรุณาเลือกไฟล์ใหม่';
  }
}

/**
 * Save the validated evidence file and return the metadata to persist. Never
 * throws (evidence is optional): on any storage/config problem it returns
 * UPLOAD_FAILED metadata and audits — the request itself still succeeds.
 */
async function attachEvidenceFiles(
  requestId: string,
  employeeId: string,
  files: ValidatedEvidence[],
  correlationId: string,
): Promise<EvidenceMetadata> {
  const first = files[0];
  const base: EvidenceMetadata = {
    ...emptyEvidenceMetadata(),
    evidenceOriginalFileName: first.originalFileName,
    evidenceMimeType: first.mime,
    evidenceSize: first.size,
    evidenceSha256: first.sha256,
  };
  const dir = env.leaveEvidenceDir();
  if (!dir || !isValidEvidenceEmployeeId(employeeId)) {
    logger.warn('evidence_upload_failed', {
      correlationId, route: ROUTE, leaveRequestId: requestId, result: 'error',
      code: 'EVIDENCE_UPLOAD_FAILED', detail: !dir ? 'storage_not_configured' : 'employeeId_format',
    });
    await auditLog.append({ requestId, action: 'EVIDENCE_UPLOAD_FAILED', detail: !dir ? 'storage not configured' : 'employeeId format' });
    logger.warn('leave_evidence_upload', {
      correlationId, leaveRequestId: requestId, fileCount: files.length,
      acceptedCount: 0, failedCount: files.length, totalBytes: files.reduce((n, file) => n + file.size, 0), result: 'error',
    });
    return { ...base, evidenceStatus: 'UPLOAD_FAILED' };
  }
  const written: string[] = [];
  try {
    const uploadedAt = nowIso();
    const records: LeaveEvidenceRecord[] = [];
    for (const file of files) {
      const saved = await saveEvidence({ root: dir, employeeId, requestId, bytes: file.bytes, ext: file.ext });
      written.push(saved.relativePath);
      records.push({
        evidenceId: evidenceRepo.generateEvidenceId(),
        requestId,
        employeeId,
        originalName: file.originalFileName,
        storedName: saved.storedFileName,
        mimeType: file.mime,
        size: file.size,
        relativePath: saved.relativePath,
        uploadedAt,
        status: 'AVAILABLE',
        sha256: file.sha256,
      });
    }
    // Metadata is committed only after every file has been written.
    await evidenceRepo.appendMany(records);
    await auditLog.append({
      requestId, action: 'EVIDENCE_ATTACHED',
      detail: `${records.length} file(s), ${records.reduce((n, record) => n + record.size, 0)}B`,
    });
    logger.info('leave_evidence_upload', {
      correlationId, leaveRequestId: requestId, fileCount: records.length,
      acceptedCount: records.length, failedCount: 0,
      totalBytes: records.reduce((n, record) => n + record.size, 0), result: 'ok',
    });
    return {
      ...base,
      evidenceStatus: 'AVAILABLE',
      evidenceStoredFileName: records[0].storedName,
      evidenceRelativePath: records[0].relativePath,
      evidenceUploadedAt: uploadedAt,
    };
  } catch (err) {
    // Best-effort rollback is scoped strictly to files created by this attempt.
    await Promise.all(written.map((relativePath) => deleteEvidence(dir, relativePath)));
    logger.warn('evidence_upload_failed', {
      correlationId, route: ROUTE, leaveRequestId: requestId, result: 'error',
      code: 'EVIDENCE_UPLOAD_FAILED', detail: err instanceof Error ? err.message.slice(0, 120) : 'error',
    });
    logger.warn('leave_evidence_upload', {
      correlationId, leaveRequestId: requestId, fileCount: files.length,
      acceptedCount: 0, failedCount: files.length,
      totalBytes: files.reduce((n, file) => n + file.size, 0), result: 'error',
    });
    await auditLog.append({ requestId, action: 'EVIDENCE_UPLOAD_FAILED', detail: 'storage write failed' });
    return { ...base, evidenceStatus: 'UPLOAD_FAILED' };
  }
}
