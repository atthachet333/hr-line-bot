import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnvelopeResult } from '@/lib/google-apps-script/client';

const callMock = vi.fn<() => Promise<EnvelopeResult>>();

vi.mock('@/lib/google-apps-script/client', () => ({
  callAppsScriptEnvelope: (...args: unknown[]) => callMock(...(args as [])),
}));

import { assertSufficientBalance } from '@/lib/services/leave-balance-service';
import { BusinessRuleError } from '@/lib/errors';

function balanceOk(data: Record<string, unknown>): EnvelopeResult {
  return { ok: true, envelope: { success: true, code: 'OK', data } };
}

function envelopeFail(code: string): EnvelopeResult {
  return { ok: true, envelope: { success: false, code } };
}

beforeEach(() => callMock.mockReset());

describe('assertSufficientBalance', () => {
  it('passes when balance is sufficient', async () => {
    callMock.mockResolvedValue(balanceOk({ sickTotal: 30, sickUsed: 5 }));
    const r = await assertSufficientBalance('U1', 'ลาป่วย', 3);
    expect(r.checked).toBe(true);
    if (r.checked) expect(r.remaining).toBe(25);
  });

  it('throws INSUFFICIENT_LEAVE_BALANCE when a real balance is not enough', async () => {
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
    expect(r.skipped).toBeFalsy();
    expect(callMock).not.toHaveBeenCalled();
  });

  it('uses a short timeout for the best-effort getBalance call', async () => {
    callMock.mockResolvedValue(balanceOk({ sickTotal: 10, sickUsed: 0 }));
    await assertSufficientBalance('U1', 'ลาป่วย', 1);
    expect(callMock).toHaveBeenCalledWith(
      { action: 'getBalance', userId: 'U1' },
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  // ---- best-effort skips: submission must NOT be blocked ----

  it('skips (not throws) on transport failure / timeout / abort', async () => {
    callMock.mockResolvedValue({ ok: false, kind: 'transport', status: 0, error: 'This operation was aborted' });
    const r = await assertSufficientBalance('U1', 'ลาป่วย', 1);
    expect(r.checked).toBe(false);
    if (r.checked === false && r.skipped) {
      expect(r.skipped).toBe(true);
      expect(r.skipReason).toBe('transport');
      expect(r.bucket).toBe('sick');
    }
  });

  it('skips on EMPLOYEE_NOT_FOUND (legacy deployment)', async () => {
    callMock.mockResolvedValue(envelopeFail('EMPLOYEE_NOT_FOUND'));
    const r = await assertSufficientBalance('U1', 'ลาป่วย', 1);
    expect(r.checked).toBe(false);
    if (r.checked === false && r.skipped) expect(r.skipReason).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('skips on NOT_IMPLEMENTED', async () => {
    callMock.mockResolvedValue(envelopeFail('NOT_IMPLEMENTED'));
    const r = await assertSufficientBalance('U1', 'ลาพักร้อน', 2);
    expect(r.checked).toBe(false);
    if (r.checked === false && r.skipped) expect(r.skipReason).toBe('NOT_IMPLEMENTED');
  });

  it('skips on UNKNOWN_ACTION', async () => {
    callMock.mockResolvedValue(envelopeFail('UNKNOWN_ACTION'));
    const r = await assertSufficientBalance('U1', 'ลากิจ', 1);
    expect(r.checked).toBe(false);
    if (r.checked === false && r.skipped) expect(r.skipReason).toBe('UNKNOWN_ACTION');
  });

  it('skips (UNAVAILABLE) on any other non-success code', async () => {
    callMock.mockResolvedValue(envelopeFail('SOME_OTHER_ERROR'));
    const r = await assertSufficientBalance('U1', 'ลาป่วย', 1);
    expect(r.checked).toBe(false);
    if (r.checked === false && r.skipped) expect(r.skipReason).toBe('UNAVAILABLE');
  });

  it('skips when balance data fails the schema', async () => {
    callMock.mockResolvedValue({ ok: true, envelope: { success: true, code: 'OK', data: { sickTotal: 'nope' } } });
    const r = await assertSufficientBalance('U1', 'ลาป่วย', 1);
    expect(r.checked).toBe(false);
    if (r.checked === false && r.skipped) expect(r.skipReason).toBe('INVALID_BALANCE_DATA');
  });
});
