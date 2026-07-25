import { inclusiveDayCount } from '@/lib/utils/datetime';

export interface LeaveInput {
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  clientRequestId: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validate the leave-request payload sent by the LIFF client. Only request
 * details are trusted from the browser — never identity fields.
 */
export function validateLeaveInput(body: unknown): ValidationResult<LeaveInput> {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' };
  }
  const b = body as Record<string, unknown>;

  const leaveType = asString(b.leaveType);
  const startDate = asString(b.startDate);
  const endDate = asString(b.endDate);
  const reason = asString(b.reason);
  const clientRequestId = asString(b.clientRequestId);

  if (!leaveType || leaveType.length > 100) {
    return { ok: false, error: 'กรุณาระบุประเภทการลาให้ถูกต้อง' };
  }
  if (!DATE_RE.test(startDate)) {
    return { ok: false, error: 'วันที่เริ่มลาไม่ถูกต้อง' };
  }
  if (!DATE_RE.test(endDate)) {
    return { ok: false, error: 'วันที่สิ้นสุดไม่ถูกต้อง' };
  }

  const days = inclusiveDayCount(startDate, endDate);
  if (days === null) {
    return { ok: false, error: 'ไม่สามารถคำนวณจำนวนวันลาได้' };
  }
  if (days < 1) {
    return { ok: false, error: 'วันที่สิ้นสุดต้องไม่อยู่ก่อนวันที่เริ่มลา' };
  }
  if (days > 365) {
    return { ok: false, error: 'จำนวนวันลามากเกินไป' };
  }
  if (!reason || reason.length > 500) {
    return { ok: false, error: 'กรุณาระบุเหตุผลการลา (ไม่เกิน 500 ตัวอักษร)' };
  }
  if (!clientRequestId || clientRequestId.length > 100 || !/^[\w.\-:]+$/.test(clientRequestId)) {
    return { ok: false, error: 'คำขอไม่ถูกต้อง (idempotency key)' };
  }

  return {
    ok: true,
    value: { leaveType, startDate, endDate, reason, clientRequestId },
  };
}

/** Whole-day inclusive count, re-exported for callers that already validated. */
export function totalDays(startDate: string, endDate: string): number {
  return inclusiveDayCount(startDate, endDate) ?? 0;
}
