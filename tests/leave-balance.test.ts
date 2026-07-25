import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnvelopeResult } from '@/lib/google-apps-script/client';

const callMock = vi.fn<() => Promise<EnvelopeResult>>();

vi.mock('@/lib/google-apps-script/client', () => ({
  callAppsScriptEnvelope: (...args: unknown[]) => callMock(...(args as [])),
}));

import { assertSufficientBalance } from '@/lib/services/leave-balance-service';
import { BusinessRuleError, ExternalServiceError } from '@/lib/errors';

function balanceOk(data: Record<string, unknown>): EnvelopeResult {
  return { ok: true, envelope: { success: true, code: 'OK', data } };
}

beforeEach(() => callMock.mockReset());

describe('assertSufficientBalance', () => {
  it('passes when balance is sufficient', async () => {
    callMock.mockResolvedValue(balanceOk({ sickTotal: 30, sickUsed: 5 }));
    const r = await assertSufficientBalance('U1', 'ลาป่วย', 3);
    expect(r.checked).toBe(true);
    expect(r.remaining).toBe(25);
  });

  it('throws INSUFFICIENT_LEAVE_BALANCE when not enough', async () => {
    callMock.mockResolvedValue(balanceOk({ annualTotal: 6, annualUsed: 5 }));
    await expect(assertSufficientBalance('U1', 'ลาพักร้อน', 3)).rejects.toMatchObject({
      code: 'INSUFFICIENT_LEAVE_BALANCE',
    });
  });

  it('throws UNKNOWN_LEAVE_TYPE for an unrecognised type', async () => {
    await expect(assertSufficientBalance('U1', 'ลาแปลกๆ', 1)).rejects.toBeInstanceOf(BusinessRuleError);
    expect(callMock).not.toHaveBeenCalled();
  });

  it('does not balance-check "other" leave types', async () => {
    const r = await assertSufficientBalance('U1', 'ลาอื่นๆ (ลาบวช)', 2);
    expect(r.checked).toBe(false);
    expect(callMock).not.toHaveBeenCalled();
  });

  it('throws ExternalServiceError when the balance service fails', async () => {
    callMock.mockResolvedValue({ ok: false, kind: 'transport', status: 0, error: 'down' });
    await expect(assertSufficientBalance('U1', 'ลาป่วย', 1)).rejects.toBeInstanceOf(ExternalServiceError);
  });
});
