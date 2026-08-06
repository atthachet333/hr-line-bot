import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Employee } from '@/lib/repositories/employee-repository';
import type { BalanceSummary } from '@/lib/services/balance-summary-service';

const verifyIdentityMock = vi.fn();
vi.mock('@/lib/line/identity', () => ({
  verifyIdentity: (...a: unknown[]) => verifyIdentityMock(...a),
}));

const findByLineUserIdMock = vi.fn<() => Promise<Employee | null>>();
vi.mock('@/lib/repositories/employee-repository', () => ({
  findByLineUserId: () => findByLineUserIdMock(),
}));

const computeBalanceSummaryMock = vi.fn<() => Promise<BalanceSummary>>();
vi.mock('@/lib/services/balance-summary-service', () => ({
  computeBalanceSummary: (...a: unknown[]) => computeBalanceSummaryMock(...(a as [])),
}));

import { GET } from '@/app/api/balance/me/route';
import { BusinessRuleError } from '@/lib/errors';

const EMPLOYEE: Employee = {
  lineUserId: 'U-A',
  employeeId: 'S2A001',
  name: 'สมชาย',
  position: 'dev',
  department: 'IT',
  managerLineUserId: 'U-mgr',
};

const SUMMARY: BalanceSummary = {
  sick: { entitlement: 30, used: 2, remaining: 28 },
  business: { entitlement: 6, used: 0, remaining: 6 },
  annual: { entitlement: 6, used: 4, remaining: 2 },
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
  computeBalanceSummaryMock.mockResolvedValue(SUMMARY);
});

describe('GET /api/balance/me', () => {
  it('returns the computed balances with no-store', async () => {
    const res = await GET(req('tok'));
    const body = (await res.json()) as { success: boolean; balances: BalanceSummary };
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.success).toBe(true);
    expect(body.balances.annual).toEqual({ entitlement: 6, used: 4, remaining: 2 });
    // Identity resolved from the token → sheet; the service gets those values.
    expect(computeBalanceSummaryMock).toHaveBeenCalledWith('U-A', 'S2A001');
  });

  it('returns 401 without a token', async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(401);
    expect(verifyIdentityMock).not.toHaveBeenCalled();
  });

  it('returns EMPLOYEE_NOT_LINKED (403) when the user is not linked', async () => {
    findByLineUserIdMock.mockResolvedValue(null);
    const res = await GET(req('tok'));
    expect(res.status).toBe(403);
    expect((await res.json() as { code: string }).code).toBe('EMPLOYEE_NOT_LINKED');
    expect(computeBalanceSummaryMock).not.toHaveBeenCalled();
  });

  it('surfaces BALANCE_NOT_CONFIGURED (422) instead of a fake balance', async () => {
    computeBalanceSummaryMock.mockRejectedValue(
      new BusinessRuleError('BALANCE_NOT_CONFIGURED', 'no row', 422),
    );
    const res = await GET(req('tok'));
    expect(res.status).toBe(422);
    expect((await res.json() as { code: string }).code).toBe('BALANCE_NOT_CONFIGURED');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
