import { describe, it, expect } from 'vitest';
import {
  rowMatchesEmployee,
  summarizeDay,
  evaluateCheckin,
  evaluateCheckout,
  findByClientRequestId,
  buildAttendanceHistory,
  type AttendanceRow,
  type EmployeeKey,
} from '@/lib/attendance/attendance-core';

const A: EmployeeKey = { employeeId: 'S2A001', lineUserId: 'U-a' };
const TODAY = '2026-08-10';

function row(p: Partial<AttendanceRow>): AttendanceRow {
  return { date: TODAY, userId: '', empId: '', type: 'checkin', ...p };
}

describe('rowMatchesEmployee — canonical identity', () => {
  it('matches by canonical employeeId (trim/case-insensitive)', () => {
    expect(rowMatchesEmployee(row({ empId: ' s2a001 ' }), A)).toBe(true);
  });

  it('matches legacy rows (no empId) by stored LINE user id', () => {
    expect(rowMatchesEmployee(row({ empId: '', userId: 'U-a' }), A)).toBe(true);
  });

  it('never matches a different employee', () => {
    expect(rowMatchesEmployee(row({ empId: 'S2A002', userId: 'U-b' }), A)).toBe(false);
  });

  it('a blank empId and blank userId never match (no empty-string collision)', () => {
    const blankKey: EmployeeKey = { employeeId: '', lineUserId: '' };
    expect(rowMatchesEmployee(row({ empId: '', userId: '' }), blankKey)).toBe(false);
  });

  it('resolves the same employee whether keyed by EmpID or LINE id (Bug 1 #8)', () => {
    const byEmp = rowMatchesEmployee(row({ empId: 'S2A001', userId: '' }), A);
    const byLine = rowMatchesEmployee(row({ empId: '', userId: 'U-a' }), A);
    expect(byEmp && byLine).toBe(true);
  });
});

describe('summarizeDay', () => {
  it('counts only this employee, this business date', () => {
    const rows = [
      row({ empId: 'S2A001', type: 'checkin' }),
      row({ empId: 'S2A002', type: 'checkin' }), // other employee
      row({ empId: 'S2A001', type: 'checkin', date: '2026-08-09' }), // other date
    ];
    const day = summarizeDay(rows, A, TODAY);
    expect(day.candidateCount).toBe(1);
    expect(day.hasCheckin).toBe(true);
    expect(day.hasCheckout).toBe(false);
  });

  it('normalises a Google date-serial cell to the business date (root-cause fix)', () => {
    // 2026-08-10 as a Sheets serial (days since 1899-12-30).
    const serial = Math.round((Date.UTC(2026, 7, 10) - Date.UTC(1899, 11, 30)) / 86_400_000);
    const rows = [row({ empId: 'S2A001', type: 'checkin', date: serial })];
    const day = summarizeDay(rows, A, TODAY);
    expect(day.hasCheckin).toBe(true);
  });
});

describe('evaluateCheckin', () => {
  it('allows the first check-in of the day', () => {
    expect(evaluateCheckin({ candidateCount: 0, hasCheckin: false, hasCheckout: false }).allowed).toBe(true);
  });
  it('blocks a second check-in', () => {
    const d = evaluateCheckin({ candidateCount: 1, hasCheckin: true, hasCheckout: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('ALREADY_CHECKED_IN');
  });
});

describe('evaluateCheckout', () => {
  it('allows check-out when there is an open check-in (#5)', () => {
    const d = evaluateCheckout({ candidateCount: 1, hasCheckin: true, hasCheckout: false });
    expect(d.allowed).toBe(true);
  });

  it('says "already checked out" on a repeat check-out (#6, not "not checked in")', () => {
    const d = evaluateCheckout({ candidateCount: 2, hasCheckin: true, hasCheckout: true });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('ALREADY_CHECKED_OUT');
      expect(d.message).not.toContain('ยังไม่ได้เช็คอิน');
    }
  });

  it('says "not checked in" only when there is genuinely no check-in (#7)', () => {
    const d = evaluateCheckout({ candidateCount: 0, hasCheckin: false, hasCheckout: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe('NOT_CHECKED_IN');
      expect(d.message).toContain('ยังไม่ได้เช็คอิน');
    }
  });
});

describe('findByClientRequestId (idempotency)', () => {
  it('finds this employee\'s matching request/type', () => {
    const rows = [row({ empId: 'S2A001', type: 'checkin', clientRequestId: 'req-1' })];
    expect(findByClientRequestId(rows, A, 'checkin', 'req-1')).not.toBeNull();
  });
  it('does not match another employee or another type', () => {
    const rows = [row({ empId: 'S2A002', type: 'checkin', clientRequestId: 'req-1' })];
    expect(findByClientRequestId(rows, A, 'checkin', 'req-1')).toBeNull();
    const rows2 = [row({ empId: 'S2A001', type: 'checkout', clientRequestId: 'req-1' })];
    expect(findByClientRequestId(rows2, A, 'checkin', 'req-1')).toBeNull();
  });
});

describe('buildAttendanceHistory', () => {
  it('isolates employees and recalculates hours from current sheet times', () => {
    const rows = [
      row({ empId: 'S2A001', type: 'checkin', time: '08:30', employmentType: 'พนักงานรายวัน' }),
      row({ empId: 'S2A001', type: 'checkout', time: '17:45', workHours: 'wrong-old-value' }),
      row({ empId: 'S2A002', type: 'checkin', time: '07:00' }),
    ];
    const history = buildAttendanceHistory(rows, A, 8, 2026);
    expect(history).toHaveLength(1);
    expect(history[0].workHours).toBe(9.25);
    expect(history[0].employmentType).toBe('พนักงานรายวัน');
  });

  it('supports legacy serial dates and leaves hours blank before checkout', () => {
    const serial = Math.round((Date.UTC(2026, 7, 10) - Date.UTC(1899, 11, 30)) / 86_400_000);
    const history = buildAttendanceHistory([row({ date: serial, empId: 'S2A001', time: '08:30' })], A, 8, 2026);
    expect(history[0]).toMatchObject({ workHours: null, status: 'open', employmentType: '' });
  });

  it('returns the current checkout summary for payroll-ready history', () => {
    const history = buildAttendanceHistory([
      row({ empId: 'S2A001', type: 'checkin', time: '08:30' }),
      row({ empId: 'S2A001', type: 'checkout', time: '17:30', summary: 'ตรวจเอกสารลูกค้า 4 เคส' }),
    ], A, 8, 2026);
    expect(history[0]).toMatchObject({
      summary: 'ตรวจเอกสารลูกค้า 4 เคส',
      summaries: ['ตรวจเอกสารลูกค้า 4 เคส'],
    });
  });

  it('legacy checkout without summary remains valid', () => {
    const history = buildAttendanceHistory([
      row({ empId: 'S2A001', type: 'checkin', time: '08:30' }),
      row({ empId: 'S2A001', type: 'checkout', time: '17:30' }),
    ], A, 8, 2026);
    expect(history[0]).toMatchObject({ summary: '', summaries: [], status: 'complete' });
  });

  it('safely returns multiple checkout summaries in sheet row order', () => {
    const history = buildAttendanceHistory([
      row({ empId: 'S2A001', type: 'checkin', time: '08:30' }),
      row({ empId: 'S2A001', type: 'checkout', time: '17:30', summary: 'First checkout summary' }),
      row({ empId: 'S2A001', type: 'checkout', time: '18:00', summary: 'Second checkout summary' }),
    ], A, 8, 2026);
    expect(history[0].summaries).toEqual(['First checkout summary', 'Second checkout summary']);
    expect(history[0].summary).toBe('Second checkout summary');
  });
});
