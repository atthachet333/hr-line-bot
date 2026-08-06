import { BusinessRuleError } from '@/lib/errors';
import { findEntitlements, type Entitlements } from '@/lib/repositories/balance-repository';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';

export type BalanceCategory = 'sick' | 'business' | 'annual';

export interface CategoryBalance {
  entitlement: number;
  used: number;
  remaining: number;
}

export type BalanceSummary = Record<BalanceCategory, CategoryBalance>;

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

/**
 * Compute the leave-balance summary for a verified employee:
 *   entitlement (Balances sheet) − Σ APPROVED totalDays per category.
 *
 * Only APPROVED requests are deducted (PENDING / REJECTED never reduce the
 * balance). `remaining` is clamped at 0. Throws BALANCE_NOT_CONFIGURED when the
 * employee has no Balances row — never returns a fabricated balance.
 *
 * Identity (lineUserId + employeeId) must already be resolved from the verified
 * token + Employees sheet; nothing here trusts client input.
 */
export async function computeBalanceSummary(
  lineUserId: string,
  employeeId: string,
): Promise<BalanceSummary> {
  const entitlements = await findEntitlements(employeeId, lineUserId);
  if (!entitlements) {
    throw new BusinessRuleError(
      'BALANCE_NOT_CONFIGURED',
      'ยังไม่ได้ตั้งค่าสิทธิ์วันลาของพนักงานคนนี้ กรุณาติดต่อฝ่ายบุคคล',
      422,
    );
  }

  const used: Record<BalanceCategory, number> = { sick: 0, business: 0, annual: 0 };
  const requests = await leaveRepo.listForEmployee(lineUserId, employeeId);
  for (const req of requests) {
    if (req.status !== 'APPROVED') continue; // PENDING / REJECTED / CANCELLED do not deduct
    const category = categoryOfLeaveType(req.leaveType);
    if (!category) continue;
    const days = Number(req.totalDays);
    if (Number.isFinite(days) && days > 0) used[category] += days;
  }

  const build = (category: BalanceCategory): CategoryBalance => {
    const entitlement = round2((entitlements as Entitlements)[category]);
    const usedDays = round2(used[category]);
    return { entitlement, used: usedDays, remaining: round2(Math.max(0, entitlement - usedDays)) };
  };

  return { sick: build('sick'), business: build('business'), annual: build('annual') };
}
