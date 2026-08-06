import { BusinessRuleError } from '@/lib/errors';
import { callAppsScriptEnvelope } from '@/lib/google-apps-script/client';
import { balanceDataSchema, type BalanceData } from '@/lib/google-apps-script/schema';
import { leaveBucketOf, isRecognisedLeaveType, type LeaveBucket } from '@/lib/domain/leave-types';

/**
 * getBalance is a *best-effort* check: it must never block a leave submission
 * while the real remaining-leave data source is still being built. It runs with
 * a short timeout so a slow/unavailable Apps Script never stalls POST /api/leave.
 */
const GET_BALANCE_TIMEOUT_MS = 7_000;

/** Reason the balance check was skipped instead of enforced. */
export type BalanceSkipReason =
  // Transport / infrastructure (from EnvelopeResult.kind).
  | 'transport'
  | 'http'
  | 'invalid_json'
  | 'invalid_contract'
  | 'not_configured'
  // Application-level "not ready yet" codes (Apps Script envelope.code).
  | 'NOT_IMPLEMENTED'
  | 'EMPLOYEE_NOT_FOUND'
  | 'UNKNOWN_ACTION'
  | 'INVALID_BALANCE_DATA'
  // Any other non-success envelope code we do not recognise.
  | 'UNAVAILABLE';

export type BalanceCheckResult =
  /** Balance was fetched and there is enough left. */
  | { checked: true; bucket: LeaveBucket; remaining: number; skipped?: false }
  /** Leave type is not balance-tracked (e.g. "ลาอื่นๆ"); nothing to check. */
  | { checked: false; bucket: null; skipped?: false }
  /** Balance source was unavailable / not ready — submission proceeds anyway. */
  | { checked: false; bucket: LeaveBucket; skipped: true; skipReason: BalanceSkipReason };

function remainingFor(balance: BalanceData, bucket: LeaveBucket): number {
  const map: Record<LeaveBucket, [number, number]> = {
    sick: [balance.sickTotal ?? 0, balance.sickUsed ?? 0],
    personal: [balance.personalTotal ?? 0, balance.personalUsed ?? 0],
    annual: [balance.annualTotal ?? 0, balance.annualUsed ?? 0],
  };
  const [total, used] = map[bucket];
  return total - used;
}

/**
 * Check whether the employee has enough balance for `days` of `leaveType`.
 *
 * Policy (getBalance is best-effort, NOT a gate for creating the request):
 *  - Unknown leave type            -> BusinessRuleError(UNKNOWN_LEAVE_TYPE) (client-side classification).
 *  - Non-tracked type ("ลาอื่นๆ")  -> { checked:false, bucket:null }.
 *  - Balance fetched + sufficient  -> { checked:true, remaining }.
 *  - Balance fetched + insufficient-> BusinessRuleError(INSUFFICIENT_LEAVE_BALANCE).
 *  - Balance unavailable (timeout / abort / transport / EMPLOYEE_NOT_FOUND /
 *    NOT_IMPLEMENTED / UNKNOWN_ACTION / bad data / any other failure)
 *                                  -> { checked:false, skipped:true, skipReason }.
 *    The caller logs a warning + audit entry and still creates the request.
 *
 * Identity is NOT derived from getBalance — the caller verifies the LINE token
 * and resolves the employee from the Employees sheet before calling this.
 */
export async function assertSufficientBalance(
  lineUserId: string,
  leaveType: string,
  days: number,
): Promise<BalanceCheckResult> {
  if (!isRecognisedLeaveType(leaveType)) {
    throw new BusinessRuleError('UNKNOWN_LEAVE_TYPE', 'ไม่รู้จักประเภทการลานี้');
  }
  const bucket = leaveBucketOf(leaveType);
  if (!bucket) {
    return { checked: false, bucket: null };
  }

  const result = await callAppsScriptEnvelope(
    { action: 'getBalance', userId: lineUserId },
    { timeoutMs: GET_BALANCE_TIMEOUT_MS },
  );

  // Transport / HTTP / JSON / contract / not-configured -> best-effort skip.
  if (!result.ok) {
    return { checked: false, bucket, skipped: true, skipReason: result.kind };
  }

  const envelope = result.envelope;
  if (!envelope.success) {
    // Application-level failure. While a real balance table does not exist,
    // "not ready" codes (and any unrecognised failure) are non-fatal: never
    // reject a leave request just because balances cannot be looked up yet.
    // Only a successful lookup with a genuinely insufficient balance rejects.
    return { checked: false, bucket, skipped: true, skipReason: mapSkipCode(envelope.code) };
  }

  const parsed = balanceDataSchema.safeParse(envelope.data ?? {});
  if (!parsed.success) {
    return { checked: false, bucket, skipped: true, skipReason: 'INVALID_BALANCE_DATA' };
  }

  const remaining = remainingFor(parsed.data, bucket);
  if (days > remaining) {
    throw new BusinessRuleError('INSUFFICIENT_LEAVE_BALANCE', 'วันลาคงเหลือไม่เพียงพอ');
  }
  return { checked: true, bucket, remaining };
}

function mapSkipCode(code: string): BalanceSkipReason {
  switch (code) {
    case 'NOT_IMPLEMENTED':
    case 'EMPLOYEE_NOT_FOUND':
    case 'UNKNOWN_ACTION':
      return code;
    default:
      return 'UNAVAILABLE';
  }
}
