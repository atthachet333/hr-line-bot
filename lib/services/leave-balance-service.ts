import { BusinessRuleError, ExternalServiceError } from '@/lib/errors';
import { callAppsScriptEnvelope } from '@/lib/google-apps-script/client';
import { balanceDataSchema, type BalanceData } from '@/lib/google-apps-script/schema';
import { leaveBucketOf, isRecognisedLeaveType, type LeaveBucket } from '@/lib/domain/leave-types';

/** Fetch an employee's balance via Apps Script. Throws on transport/contract failure. */
export async function fetchBalance(lineUserId: string): Promise<BalanceData> {
  const result = await callAppsScriptEnvelope({ action: 'getBalance', userId: lineUserId });
  if (!result.ok) {
    throw new ExternalServiceError(
      'ไม่สามารถตรวจสอบยอดวันลาได้ในขณะนี้',
      `getBalance ${result.kind}: ${result.error}`,
    );
  }
  if (!result.envelope.success) {
    // Application-level failure (e.g. employee not found) — surface as external
    // error rather than silently approving.
    throw new ExternalServiceError(
      'ไม่สามารถตรวจสอบยอดวันลาได้',
      `getBalance code=${result.envelope.code}`,
    );
  }
  const parsed = balanceDataSchema.safeParse(result.envelope.data ?? {});
  if (!parsed.success) {
    throw new ExternalServiceError('รูปแบบข้อมูลยอดวันลาไม่ถูกต้อง', 'balance data failed schema');
  }
  return parsed.data;
}

function remainingFor(balance: BalanceData, bucket: LeaveBucket): number {
  const map: Record<LeaveBucket, [number, number]> = {
    sick: [balance.sickTotal ?? 0, balance.sickUsed ?? 0],
    personal: [balance.personalTotal ?? 0, balance.personalUsed ?? 0],
    annual: [balance.annualTotal ?? 0, balance.annualUsed ?? 0],
  };
  const [total, used] = map[bucket];
  return total - used;
}

export interface BalanceCheckResult {
  checked: boolean;
  bucket: LeaveBucket | null;
  remaining?: number;
}

/**
 * Ensure the employee has enough balance for `days` of `leaveType`.
 * - Unknown leave type -> BusinessRuleError(UNKNOWN_LEAVE_TYPE).
 * - Non-tracked type (e.g. "ลาอื่นๆ") -> not checked (checked:false).
 * - Tracked type -> fetch balance and compare (throws INSUFFICIENT_LEAVE_BALANCE).
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
  const balance = await fetchBalance(lineUserId);
  const remaining = remainingFor(balance, bucket);
  if (days > remaining) {
    throw new BusinessRuleError('INSUFFICIENT_LEAVE_BALANCE', 'วันลาคงเหลือไม่เพียงพอ');
  }
  return { checked: true, bucket, remaining };
}
