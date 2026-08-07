import { findEntitlements, type EntitlementFields } from '@/lib/repositories/balance-repository';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';

export type BalanceCategory = 'sick' | 'business' | 'annual';

export interface CategoryBalance {
  entitlement: number;
  used: number;
  remaining: number;
}

export type BalanceSummary = Record<BalanceCategory, CategoryBalance>;

/** Diagnostic metadata for safe logging (no PII beyond a masked id upstream). */
export interface BalanceMeta {
  balanceRowFound: boolean;
  entitlementFieldsFound: EntitlementFields;
  approvedLeaveCount: number;
}

export type BalanceOutcome =
  | { ok: true; summary: BalanceSummary; meta: BalanceMeta }
  | {
      ok: false;
      code: 'BALANCE_NOT_CONFIGURED' | 'BALANCE_DATA_INVALID';
      message: string;
      meta: BalanceMeta;
    };

/** Map a leave-type label to a tracked balance category (or null if untracked). */
export function categoryOfLeaveType(leaveType: string): BalanceCategory | null {
  const t = leaveType.trim();
  if (t.startsWith('ลาป่วย')) return 'sick';
  if (t.startsWith('ลากิจ')) return 'business';
  if (t.startsWith('ลาพักร้อน')) return 'annual';
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const NO_FIELDS: EntitlementFields = { sick: false, business: false, annual: false };

/**
 * Compute the leave-balance summary for a verified employee:
 *   entitlement (Balances sheet, keyed by employeeId) − Σ APPROVED totalDays.
 *
 * Only APPROVED requests deduct (PENDING / REJECTED never do). `remaining` is
 * clamped at 0 but `used` is left as-is (so the UI can warn about over-use).
 * Returns a discriminated outcome — never a fabricated 0 balance:
 *   - no Balances row      -> BALANCE_NOT_CONFIGURED
 *   - blank/NaN/duplicate  -> BALANCE_DATA_INVALID
 *
 * Identity (lineUserId + employeeId) must already be resolved from the verified
 * token + Employees sheet; nothing here trusts client input.
 */
export async function computeBalanceSummary(
  lineUserId: string,
  employeeId: string,
): Promise<BalanceOutcome> {
  // Usage always comes from APPROVED LeaveRequests (independent of entitlements).
  const requests = await leaveRepo.listForEmployee(lineUserId, employeeId);
  const used: Record<BalanceCategory, number> = { sick: 0, business: 0, annual: 0 };
  let approvedLeaveCount = 0;
  for (const req of requests) {
    if (req.status !== 'APPROVED') continue; // PENDING / REJECTED / CANCELLED do not deduct
    const category = categoryOfLeaveType(req.leaveType);
    if (!category) continue;
    const days = Number(req.totalDays);
    if (Number.isFinite(days) && days > 0) {
      used[category] += days;
      approvedLeaveCount += 1;
    }
  }

  const lookup = await findEntitlements(employeeId);

  if (lookup.status === 'not_found') {
    return {
      ok: false,
      code: 'BALANCE_NOT_CONFIGURED',
      message: 'ยังไม่ได้กำหนดสิทธิ์วันลาของคุณ กรุณาติดต่อฝ่ายบุคคล',
      meta: { balanceRowFound: false, entitlementFieldsFound: NO_FIELDS, approvedLeaveCount },
    };
  }
  if (lookup.status === 'duplicate') {
    return {
      ok: false,
      code: 'BALANCE_DATA_INVALID',
      message: 'ข้อมูลสิทธิ์วันลาไม่ถูกต้อง กรุณาติดต่อฝ่ายบุคคล',
      meta: { balanceRowFound: true, entitlementFieldsFound: NO_FIELDS, approvedLeaveCount },
    };
  }
  if (lookup.status === 'invalid') {
    return {
      ok: false,
      code: 'BALANCE_DATA_INVALID',
      message: 'ข้อมูลสิทธิ์วันลาไม่ถูกต้อง กรุณาติดต่อฝ่ายบุคคล',
      meta: { balanceRowFound: true, entitlementFieldsFound: lookup.fields, approvedLeaveCount },
    };
  }

  const build = (category: BalanceCategory): CategoryBalance => {
    const entitlement = round2(lookup.entitlements[category]);
    const usedDays = round2(used[category]);
    return { entitlement, used: usedDays, remaining: round2(Math.max(0, entitlement - usedDays)) };
  };

  return {
    ok: true,
    summary: { sick: build('sick'), business: build('business'), annual: build('annual') },
    meta: { balanceRowFound: true, entitlementFieldsFound: lookup.fields, approvedLeaveCount },
  };
}
