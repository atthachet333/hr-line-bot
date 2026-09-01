import { describe, it, expect } from 'vitest';
import {
  buildAttendanceHistory,
  calculateAttendanceSummary,
  type AttendanceRow,
  type EmployeeKey,
} from '@/lib/attendance/attendance-core';

const A: EmployeeKey = { employeeId: 'S2A001', lineUserId: 'U-a' };

function row(p: Partial<AttendanceRow>): AttendanceRow {
  return { date: '2026-08-01', userId: 'U-a', empId: 'S2A001', type: 'checkin', time: '08:30', ...p };
}

/** Build Aug-2026 history for A, then summarise — mirrors the API path. */
function summarize(rows: AttendanceRow[], month = 8, year = 2026, key: EmployeeKey = A) {
  return calculateAttendanceSummary(buildAttendanceHistory(rows, key, month, year));
}

describe('calculateAttendanceSummary (via buildAttendanceHistory)', () => {
  it('#4 08:30–17:45 on one day = 555 minutes, 1 work day', () => {
    const s = summarize([
      row({ date: '2026-08-01', type: 'checkin', time: '08:30' }),
      row({ date: '2026-08-01', type: 'checkout', time: '17:45' }),
    ]);
    expect(s).toEqual({ workDays: 1, totalMinutes: 555 });
  });

  it('#3 totalMinutes sums multiple complete days (9:15 + 9:15 = 18:30 = 1110)', () => {
    const s = summarize([
      row({ date: '2026-08-01', type: 'checkin', time: '08:30' }),
      row({ date: '2026-08-01', type: 'checkout', time: '17:45' }),
      row({ date: '2026-08-02', type: 'checkin', time: '08:15' }),
      row({ date: '2026-08-02', type: 'checkout', time: '17:30' }),
    ]);
    expect(s).toEqual({ workDays: 2, totalMinutes: 1110 });
  });

  it('#1/#2 workDays counts unique dates with a check-in (label differs by type, math same)', () => {
    const rows = [
      row({ date: '2026-08-01', type: 'checkin' }),
      row({ date: '2026-08-02', type: 'checkin' }),
      row({ date: '2026-08-03', type: 'checkin' }),
    ];
    expect(summarize(rows).workDays).toBe(3);
  });

  it('#5/#6 open day counts as a work day but adds no duration', () => {
    const s = summarize([
      row({ date: '2026-08-01', type: 'checkin', time: '08:30' }),
      row({ date: '2026-08-01', type: 'checkout', time: '17:30' }), // complete: 540
      row({ date: '2026-08-02', type: 'checkin', time: '09:00' }),  // open, no checkout
    ]);
    expect(s).toEqual({ workDays: 2, totalMinutes: 540 });
  });

  it('#7 duplicate event rows on the same date do not double-count the work day', () => {
    const s = summarize([
      row({ date: '2026-08-01', type: 'checkin', time: '08:30' }),
      row({ date: '2026-08-01', type: 'checkin', time: '08:31' }), // duplicate checkin
      row({ date: '2026-08-01', type: 'checkout', time: '17:30' }),
    ]);
    expect(s.workDays).toBe(1);
  });

  it('#8 employee A summary never includes employee B rows', () => {
    const s = summarize([
      row({ date: '2026-08-01', type: 'checkin', time: '08:30' }),
      row({ date: '2026-08-01', type: 'checkout', time: '17:30' }),
      row({ date: '2026-08-02', empId: 'S2A002', userId: 'U-b', type: 'checkin', time: '07:00' }),
      row({ date: '2026-08-02', empId: 'S2A002', userId: 'U-b', type: 'checkout', time: '19:00' }),
    ]);
    expect(s).toEqual({ workDays: 1, totalMinutes: 540 });
  });

  it('#9 month filter excludes other months', () => {
    const s = summarize([
      row({ date: '2026-08-01', type: 'checkin', time: '08:30' }),
      row({ date: '2026-08-01', type: 'checkout', time: '17:30' }),
      row({ date: '2026-07-15', type: 'checkin', time: '08:00' }), // other month
      row({ date: '2026-07-15', type: 'checkout', time: '17:00' }),
    ]);
    expect(s).toEqual({ workDays: 1, totalMinutes: 540 });
  });

  it('#10 year filter excludes other years', () => {
    const s = summarize([
      row({ date: '2026-08-01', type: 'checkin', time: '08:30' }),
      row({ date: '2026-08-01', type: 'checkout', time: '17:30' }),
      row({ date: '2025-08-01', type: 'checkin', time: '08:00' }), // other year
      row({ date: '2025-08-01', type: 'checkout', time: '17:00' }),
    ]);
    expect(s).toEqual({ workDays: 1, totalMinutes: 540 });
  });

  it('#11 empty month = 0 days / 0 minutes', () => {
    expect(summarize([])).toEqual({ workDays: 0, totalMinutes: 0 });
  });

  it('#12 blank employmentType does not error', () => {
    const items = buildAttendanceHistory(
      [row({ date: '2026-08-01', type: 'checkin', employmentType: '' }),
       row({ date: '2026-08-01', type: 'checkout', time: '17:30', employmentType: '' })],
      A, 8, 2026, '',
    );
    expect(() => calculateAttendanceSummary(items)).not.toThrow();
    expect(items[0].employmentType).toBe('');
  });

  it('#14 legacy rows (no empId) still counted via lineUserId', () => {
    const s = summarize([
      row({ date: '2026-08-01', empId: '', userId: 'U-a', type: 'checkin', time: '08:30' }),
      row({ date: '2026-08-01', empId: '', userId: 'U-a', type: 'checkout', time: '17:30' }),
    ]);
    expect(s).toEqual({ workDays: 1, totalMinutes: 540 });
  });

  it('#15/#16 date-serial cells are honoured in Asia/Bangkok business dates', () => {
    const serialAug1 = Math.round((Date.UTC(2026, 7, 1) - Date.UTC(1899, 11, 30)) / 86_400_000);
    const s = summarize([
      row({ date: serialAug1, type: 'checkin', time: '08:30' }),
      row({ date: serialAug1, type: 'checkout', time: '17:30' }),
    ]);
    expect(s).toEqual({ workDays: 1, totalMinutes: 540 });
  });

  it('#13 recomputes when the sheet check-out time changes (source of truth)', () => {
    const early = summarize([
      row({ date: '2026-08-01', type: 'checkin', time: '08:30' }),
      row({ date: '2026-08-01', type: 'checkout', time: '17:30' }),
    ]);
    const edited = summarize([
      row({ date: '2026-08-01', type: 'checkin', time: '08:30' }),
      row({ date: '2026-08-01', type: 'checkout', time: '18:00' }), // HR edited later
    ]);
    expect(early.totalMinutes).toBe(540);
    expect(edited.totalMinutes).toBe(570);
  });

  it('supports seconds and rounds the aggregate to whole minutes', () => {
    const s = summarize([
      row({ date: '2026-08-01', type: 'checkin', time: '08:00:00' }),
      row({ date: '2026-08-01', type: 'checkout', time: '08:30:30' }), // 30m30s
    ]);
    expect(s.totalMinutes).toBe(31); // 30.5 → 31 (rounded)
  });

  it('daily multi-session totals sum completed sessions but count one unique work date', () => {
    const s = summarize([
      row({ type: 'checkin', time: '08:00' }),
      row({ type: 'checkout', time: '11:00', workHours: 3 }),
      row({ type: 'checkin', time: '13:00' }),
      row({ type: 'checkout', time: '17:30', workHours: 4.5 }),
      row({ type: 'checkin', time: '18:00' }),
      row({ type: 'checkout', time: '20:00', workHours: 2 }),
    ]);
    expect(s).toEqual({ workDays: 1, totalMinutes: 570 });
  });
});
