import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyIdentityMock = vi.fn();
vi.mock('@/lib/line/identity', () => ({
  verifyIdentity: (...args: unknown[]) => verifyIdentityMock(...args),
}));

const findByLineUserIdMock = vi.fn();
vi.mock('@/lib/repositories/employee-repository', () => ({
  findByLineUserId: (...args: unknown[]) => findByLineUserIdMock(...args),
}));

const recordAttendanceMock = vi.fn();
vi.mock('@/lib/attendance/attendance-repository', () => ({
  recordAttendance: (...args: unknown[]) => recordAttendanceMock(...args),
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: () => ({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 }),
}));

import { POST } from '@/app/api/attendance/check-out/route';

function request(summary: unknown, extra: Record<string, unknown> = {}): Request {
  return new Request('http://localhost:3333/api/attendance/check-out', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer verified-token' },
    body: JSON.stringify({
      lat: 13.7,
      lng: 100.5,
      time: '17:30:00',
      clientRequestId: 'checkout-request-1',
      summary,
      ...extra,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyIdentityMock.mockResolvedValue({ ok: true, identity: { lineUserId: 'U-verified', displayName: 'LINE name' } });
  findByLineUserIdMock.mockResolvedValue({
    lineUserId: 'U-verified', employeeId: 'S2A001', name: 'Sheet employee', employmentType: 'พนักงานประจำ',
  });
  recordAttendanceMock.mockResolvedValue({
    ok: true,
    code: 'CHECK_OUT_RECORDED',
    message: 'บันทึกเวลาออกงานสำเร็จ',
    data: { date: '2026-08-31', type: 'checkout' },
    diag: { businessDate: '2026-08-31', employeeResolved: true, candidateCount: 1, openCheckinFound: true, reason: 'recorded' },
  });
});

describe('POST /api/attendance/check-out work summary policy', () => {
  it.each([
    [undefined, 'WORK_SUMMARY_REQUIRED'],
    ['', 'WORK_SUMMARY_REQUIRED'],
    ['   ', 'WORK_SUMMARY_REQUIRED'],
    ['ทำงาน', 'WORK_SUMMARY_TOO_SHORT'],
    ['123456789', 'WORK_SUMMARY_TOO_SHORT'],
    ['x'.repeat(1001), 'WORK_SUMMARY_TOO_LONG'],
  ])('rejects invalid summary without creating a checkout row', async (summary, detail) => {
    const response = await POST(request(summary));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.detail).toBe(detail);
    expect(recordAttendanceMock).not.toHaveBeenCalled();
  });

  it.each([
    '1234567890',
    'ตรวจเอกสารลูกค้า 4 เคส อัปเดตข้อมูลเรียบร้อย',
    'Updated customer records and prepared the daily report.',
  ])('accepts and persists a valid summary: %s', async (summary) => {
    const response = await POST(request(`  ${summary}  `));
    expect(response.status).toBe(200);
    expect(recordAttendanceMock).toHaveBeenCalledWith(expect.objectContaining({ summary }));
  });

  it('derives identity from the verified token and Employees sheet, not the request body', async () => {
    const response = await POST(request('Completed customer documentation today', {
      lineUserId: 'U-attacker', employeeId: 'HACKER', displayName: 'Attacker', employmentType: 'CEO',
    }));
    expect(response.status).toBe(200);
    expect(verifyIdentityMock).toHaveBeenCalledWith({ idToken: undefined, accessToken: 'verified-token' });
    expect(findByLineUserIdMock).toHaveBeenCalledWith('U-verified');
    expect(recordAttendanceMock).toHaveBeenCalledWith(expect.objectContaining({
      lineUserId: 'U-verified', employeeId: 'S2A001', displayName: 'Sheet employee', employmentType: 'พนักงานประจำ',
    }));
  });
});
