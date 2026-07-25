/** Allowlisted rejection reasons. Managers pick a code; the label is stored. */

export const REJECT_REASONS = [
  { code: 'INSUFFICIENT_BALANCE', label: 'วันลาคงเหลือไม่เพียงพอ' },
  { code: 'BUSY_PERIOD', label: 'มีงานสำคัญในช่วงดังกล่าว' },
  { code: 'INVALID_DATES', label: 'วันที่ลาไม่ถูกต้อง' },
  { code: 'NEED_MORE_INFO', label: 'กรุณาแก้ไขรายละเอียดและส่งใหม่' },
  { code: 'CONTACT_MANAGER', label: 'กรุณาติดต่อหัวหน้างาน' },
  { code: 'OTHER', label: 'ไม่อนุมัติ (ไม่ระบุเหตุผลเฉพาะ)' },
] as const;

export type RejectReasonCode = (typeof REJECT_REASONS)[number]['code'];

const BY_CODE = new Map(REJECT_REASONS.map((r) => [r.code, r.label] as const));

export function isValidRejectReasonCode(code: string): code is RejectReasonCode {
  return BY_CODE.has(code as RejectReasonCode);
}

export function rejectReasonLabel(code: string): string {
  return BY_CODE.get(code as RejectReasonCode) ?? 'ไม่อนุมัติ';
}

export const MAX_REJECT_NOTE_LENGTH = 300;

/** Trim + cap a manager's free-text note. */
export function sanitiseNote(note: string | undefined): string {
  if (!note) return '';
  return note.replace(/\s+/g, ' ').trim().slice(0, MAX_REJECT_NOTE_LENGTH);
}
