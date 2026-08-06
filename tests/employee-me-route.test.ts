import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Employee } from '@/lib/repositories/employee-repository';

const verifyIdentityMock = vi.fn();
vi.mock('@/lib/line/identity', () => ({
  verifyIdentity: (...a: unknown[]) => verifyIdentityMock(...a),
}));

const findByLineUserIdMock = vi.fn<() => Promise<Employee | null>>();
vi.mock('@/lib/repositories/employee-repository', () => ({
  findByLineUserId: () => findByLineUserIdMock(),
}));

const infoMock = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: { info: (...a: unknown[]) => infoMock(...a), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  redact: (v: unknown) => v,
}));

import { GET } from '@/app/api/employee/me/route';

const EMPLOYEE: Employee = {
  lineUserId: 'U87b0000000000000000000000000e24',
  employeeId: 'S2A007',
  name: 'อาร์ม',
  position: 'dev',
  department: 'IT',
  managerLineUserId: 'U-mgr',
};

function req(token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request('http://localhost:3333/api/employee/me', { method: 'GET', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyIdentityMock.mockResolvedValue({ ok: true, identity: { lineUserId: EMPLOYEE.lineUserId } });
  findByLineUserIdMock.mockResolvedValue(EMPLOYEE);
});

describe('GET /api/employee/me', () => {
  it('returns linked:true with the sheet employee (no LINE id leaked)', async () => {
    const res = await GET(req('tok'));
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.linked).toBe(true);
    expect((body.employee as Record<string, unknown>).employeeId).toBe('S2A007');
    expect(body.employee).not.toHaveProperty('lineUserId');
  });

  it('returns linked:false with a masked diagnostic log when not linked', async () => {
    findByLineUserIdMock.mockResolvedValue(null);
    const res = await GET(req('tok'));
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.linked).toBe(false);
    expect(body.code).toBe('EMPLOYEE_NOT_LINKED');
    // Diagnostic log carries a MASKED id, never the full one.
    const logged = infoMock.mock.calls.find((c) => (c[0] as string) === 'employee_me')?.[1] as Record<string, unknown>;
    expect(logged.verifiedLineUserIdMasked).toContain('…');
    expect(logged.verifiedLineUserIdMasked).not.toBe(EMPLOYEE.lineUserId);
    expect(JSON.stringify(infoMock.mock.calls)).not.toContain(EMPLOYEE.lineUserId);
  });

  it('returns 401 with no token', async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(401);
    expect(verifyIdentityMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the token fails verification', async () => {
    verifyIdentityMock.mockResolvedValue({ ok: false, error: 'bad' });
    const res = await GET(req('bad'));
    expect(res.status).toBe(401);
    expect(findByLineUserIdMock).not.toHaveBeenCalled();
  });
});
