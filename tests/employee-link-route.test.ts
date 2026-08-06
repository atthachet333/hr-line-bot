import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Employee, LinkResult } from '@/lib/repositories/employee-repository';

const verifyIdentityMock = vi.fn();
vi.mock('@/lib/line/identity', () => ({
  verifyIdentity: (...a: unknown[]) => verifyIdentityMock(...a),
}));

const linkEmployeeMock = vi.fn<() => Promise<LinkResult>>();
vi.mock('@/lib/repositories/employee-repository', () => ({
  linkEmployee: () => linkEmployeeMock(),
  normalizeEmployeeId: (s: string) => s.trim().toUpperCase(),
}));

const appendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/repositories/audit-log-repository', () => ({
  append: (...a: unknown[]) => appendMock(...a),
}));

import { POST } from '@/app/api/employee/link/route';

const EMP: Employee = {
  lineUserId: 'U-arm',
  employeeId: 'S2A007',
  name: 'อาร์ม',
  position: 'dev',
  department: 'IT',
  managerLineUserId: 'U-mgr',
};

function req(body: unknown, token: string | null = 'tok'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request('http://localhost:3333/api/employee/link', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyIdentityMock.mockResolvedValue({ ok: true, identity: { lineUserId: 'U-arm' } });
});

describe('POST /api/employee/link', () => {
  it('links successfully and writes an audit entry', async () => {
    linkEmployeeMock.mockResolvedValue({ status: 'linked', employee: EMP });
    const res = await POST(req({ employeeId: 'S2A007' }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect((body.data as Record<string, unknown>).linked).toBe(true);
    const actions = appendMock.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).toContain('EMPLOYEE_LINKED');
  });

  it('is idempotent (already_linked) without a duplicate audit entry', async () => {
    linkEmployeeMock.mockResolvedValue({ status: 'already_linked', employee: EMP });
    const res = await POST(req({ employeeId: 'S2A007' }));
    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, unknown>).success).toBe(true);
    expect(appendMock).not.toHaveBeenCalled();
  });

  it('EMPLOYEE_NOT_FOUND → 404', async () => {
    linkEmployeeMock.mockResolvedValue({ status: 'employee_not_found' });
    const res = await POST(req({ employeeId: 'NOPE' }));
    expect(res.status).toBe(404);
    expect((await res.json() as Record<string, unknown>).code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('EMPLOYEE_ALREADY_LINKED → 409', async () => {
    linkEmployeeMock.mockResolvedValue({ status: 'employee_already_linked' });
    const res = await POST(req({ employeeId: 'S2A007' }));
    expect(res.status).toBe(409);
    expect((await res.json() as Record<string, unknown>).code).toBe('EMPLOYEE_ALREADY_LINKED');
  });

  it('LINE_ACCOUNT_ALREADY_LINKED → 409', async () => {
    linkEmployeeMock.mockResolvedValue({ status: 'line_already_linked', employeeId: 'S2A001' });
    const res = await POST(req({ employeeId: 'S2A007' }));
    expect(res.status).toBe(409);
    expect((await res.json() as Record<string, unknown>).code).toBe('LINE_ACCOUNT_ALREADY_LINKED');
  });

  it('rejects a missing/invalid employeeId', async () => {
    const res = await POST(req({ employeeId: '' }));
    expect(res.status).toBe(400);
    expect(linkEmployeeMock).not.toHaveBeenCalled();
  });

  it('returns 401 without a token and never touches the sheet', async () => {
    const res = await POST(req({ employeeId: 'S2A007' }, null));
    expect(res.status).toBe(401);
    expect(verifyIdentityMock).not.toHaveBeenCalled();
    expect(linkEmployeeMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the token fails verification', async () => {
    verifyIdentityMock.mockResolvedValue({ ok: false, error: 'bad' });
    const res = await POST(req({ employeeId: 'S2A007' }));
    expect(res.status).toBe(401);
    expect(linkEmployeeMock).not.toHaveBeenCalled();
  });
});
