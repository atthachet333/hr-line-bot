import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Employee } from '@/lib/repositories/employee-repository';
import type { BalanceOutcome } from '@/lib/services/balance-summary-service';

const verifyIdentityMock = vi.fn();
vi.mock('@/lib/line/identity', () => ({
  verifyIdentity: (...a: unknown[]) => verifyIdentityMock(...a),
}));

const findByLineUserIdMock = vi.fn<() => Promise<Employee | null>>();
vi.mock('@/lib/repositories/employee-repository', () => ({
  findByLineUserId: () => findByLineUserIdMock(),
}));

const computeBalanceSummaryMock = vi.fn<() => Promise<BalanceOutcome>>();
vi.mock('@/lib/services/balance-summary-service', () => ({
  computeBalanceSummary: (...a: unknown[]) => computeBalanceSummaryMock(...(a as [])),
}));

import { GET } from '@/app/api/balance/me/route';

const EMPLOYEE: Employee = {
  lineUserId: 'U-A', employeeId: 'S2A001', name: 'สมชาย', position: 'dev', department: 'IT', managerLineUserId: 'U-mgr',
};

const OK_OUTCOME: BalanceOutcome = {
  ok: true,
  summary: {
    sick: { entitlement: 30, used: 2, remaining: 28 },
    business: { entitlement: 6, used: 0, remaining: 6 },
    annual: { entitlement: 6, used: 4, remaining: 2 },
  },
  meta: { balanceRowFound: true, entitlementFieldsFound: { sick: true, business: true, annual: true }, approvedLeaveCount: 2 },
};

function req(token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request('http://localhost:3333/api/balance/me', { method: 'GET', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyIdentityMock.mockResolvedValue({ ok: true, identity: { lineUserId: 'U-A' } });
  findByLineUserIdMock.mockResolvedValue(EMPLOYEE);
  computeBalanceSummaryMock.mockResolvedValue(OK_OUTCOME);
});

describe('GET /api/balance/me', () => {
  it('returns balances + source with no-store', async () => {
    const res = await GET(req('tok'));
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.success).toBe(true);
    expect((body.balances as Record<string, unknown>).annual).toEqual({ entitlement: 6, used: 4, remaining: 2 });
    expect(body.source).toEqual({ entitlement: 'Balances', used: 'LeaveRequests' });
    expect(computeBalanceSummaryMock).toHaveBeenCalledWith('U-A', 'S2A001');
  });

  it('returns 401 without a token', async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(401);
    expect(verifyIdentityMock).not.toHaveBeenCalled();
  });

  it('maps EMPLOYEE_NOT_LINKED to 403', async () => {
    findByLineUserIdMock.mockResolvedValue(null);
    const res = await GET(req('tok'));
    expect(res.status).toBe(403);
    expect((await res.json() as { code: string }).code).toBe('EMPLOYEE_NOT_LINKED');
    expect(computeBalanceSummaryMock).not.toHaveBeenCalled();
  });

  it('maps BALANCE_NOT_CONFIGURED to 422 (no fake balance)', async () => {
    computeBalanceSummaryMock.mockResolvedValue({
      ok: false, code: 'BALANCE_NOT_CONFIGURED', message: 'no row',
      meta: { balanceRowFound: false, entitlementFieldsFound: { sick: false, business: false, annual: false }, approvedLeaveCount: 0 },
    });
    const res = await GET(req('tok'));
    expect(res.status).toBe(422);
    expect((await res.json() as { code: string }).code).toBe('BALANCE_NOT_CONFIGURED');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('maps BALANCE_DATA_INVALID to 422', async () => {
    computeBalanceSummaryMock.mockResolvedValue({
      ok: false, code: 'BALANCE_DATA_INVALID', message: 'bad',
      meta: { balanceRowFound: true, entitlementFieldsFound: { sick: false, business: true, annual: true }, approvedLeaveCount: 1 },
    });
    const res = await GET(req('tok'));
    expect(res.status).toBe(422);
    expect((await res.json() as { code: string }).code).toBe('BALANCE_DATA_INVALID');
  });
});
