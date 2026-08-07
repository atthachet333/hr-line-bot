import { describe, it, expect } from 'vitest';
import { validateLeaveInput } from '@/lib/validation/leave';
import { validateAttendanceInput } from '@/lib/validation/attendance';
import { inclusiveDayCount } from '@/lib/utils/datetime';
import { generateRequestId, isValidRequestId } from '@/lib/utils/request-id';

describe('leave validation', () => {
  const base = {
    leaveType: 'ลาป่วย',
    startDate: '2026-07-25',
    endDate: '2026-07-27',
    reason: 'ไม่สบาย',
    clientRequestId: 'abc',
  };

  it('accepts a valid request', () => {
    const r = validateLeaveInput(base);
    expect(r.ok).toBe(true);
  });

  it('rejects end date before start date (test case: invalid dates)', () => {
    const r = validateLeaveInput({ ...base, startDate: '2026-07-27', endDate: '2026-07-25' });
    expect(r.ok).toBe(false);
  });

  it('rejects malformed dates', () => {
    const r = validateLeaveInput({ ...base, startDate: '25/07/2026' });
    expect(r.ok).toBe(false);
  });

  it('rejects empty reason', () => {
    const r = validateLeaveInput({ ...base, reason: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects empty leave type', () => {
    const r = validateLeaveInput({ ...base, leaveType: '' });
    expect(r.ok).toBe(false);
  });
});

describe('attendance validation', () => {
  it('accepts valid coordinates', () => {
    const r = validateAttendanceInput({ lat: 13.7, lng: 100.5, time: '09:00:00' });
    expect(r.ok).toBe(true);
  });

  it('rejects out-of-range latitude', () => {
    const r = validateAttendanceInput({ lat: 200, lng: 100.5, time: '09:00:00' });
    expect(r.ok).toBe(false);
  });

  // Bug 2: work summary is OPTIONAL on check-out — the default (checkout) path
  // must accept an empty summary and a missing summary field without error.
  it('accepts check-out with empty summary (default = optional)', () => {
    const r = validateAttendanceInput({ lat: 13.7, lng: 100.5, time: '18:00:00', summary: '' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.summary).toBeUndefined();
  });

  it('accepts check-out with no summary field at all', () => {
    const r = validateAttendanceInput({ lat: 13.7, lng: 100.5, time: '18:00:00' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.summary).toBeUndefined();
  });

  it('keeps the summary text when provided', () => {
    const r = validateAttendanceInput({ lat: 13.7, lng: 100.5, time: '18:00:00', summary: '  ทำรายงาน  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.summary).toBe('ทำรายงาน');
  });

  it('still caps an abnormally long summary', () => {
    const r = validateAttendanceInput({ lat: 13.7, lng: 100.5, time: '18:00:00', summary: 'x'.repeat(2001) });
    expect(r.ok).toBe(false);
  });

  it('the (now unused) requireSummary option still works for other callers', () => {
    const r = validateAttendanceInput({ lat: 13.7, lng: 100.5, time: '18:00:00' }, { requireSummary: true });
    expect(r.ok).toBe(false);
  });
});

describe('date + request id helpers', () => {
  it('counts inclusive days', () => {
    expect(inclusiveDayCount('2026-07-25', '2026-07-27')).toBe(3);
    expect(inclusiveDayCount('2026-07-25', '2026-07-25')).toBe(1);
  });

  it('generates valid, unique request ids', () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(isValidRequestId(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(isValidRequestId('REQ-bad')).toBe(false);
  });
});
