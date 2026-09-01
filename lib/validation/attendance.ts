import type { ValidationResult } from './leave';

export interface AttendanceInput {
  lat: number;
  lng: number;
  time: string;
  summary?: string;
}

export const WORK_SUMMARY_MIN_LENGTH = 10;
export const WORK_SUMMARY_MAX_LENGTH = 1000;
export type WorkSummaryValidationDetail =
  | 'WORK_SUMMARY_REQUIRED'
  | 'WORK_SUMMARY_TOO_SHORT'
  | 'WORK_SUMMARY_TOO_LONG';

export type WorkSummaryValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string; detail: WorkSummaryValidationDetail };

/** Shared client/server policy. The returned value is always trimmed. */
export function validateWorkSummary(value: unknown): WorkSummaryValidationResult {
  const summary = typeof value === 'string' ? value.trim() : '';
  if (!summary) {
    return {
      ok: false,
      error: 'กรุณาระบุรายละเอียดงานที่ทำวันนี้อย่างน้อย 10 ตัวอักษร',
      detail: 'WORK_SUMMARY_REQUIRED',
    };
  }
  if (summary.length < WORK_SUMMARY_MIN_LENGTH) {
    return {
      ok: false,
      error: 'กรุณาระบุรายละเอียดงานที่ทำวันนี้อย่างน้อย 10 ตัวอักษร',
      detail: 'WORK_SUMMARY_TOO_SHORT',
    };
  }
  if (summary.length > WORK_SUMMARY_MAX_LENGTH) {
    return {
      ok: false,
      error: 'สรุปงานวันนี้ต้องไม่เกิน 1,000 ตัวอักษร',
      detail: 'WORK_SUMMARY_TOO_LONG',
    };
  }
  return { ok: true, value: summary };
}

/** Pure UI gate; the server still validates independently and is authoritative. */
export function canSubmitCheckout(input: {
  hasLocation: boolean;
  summary: unknown;
  isSubmitting: boolean;
}): boolean {
  return input.hasLocation && !input.isSubmitting && validateWorkSummary(input.summary).ok;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function validateAttendanceInput(
  body: unknown,
  opts: { requireSummary?: boolean } = {},
): ValidationResult<AttendanceInput> & { detail?: WorkSummaryValidationDetail } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' };
  }
  const b = body as Record<string, unknown>;

  const lat = asNumber(b.lat);
  const lng = asNumber(b.lng);
  if (lat === null || lat < -90 || lat > 90) {
    return { ok: false, error: 'พิกัดละติจูดไม่ถูกต้อง' };
  }
  if (lng === null || lng < -180 || lng > 180) {
    return { ok: false, error: 'พิกัดลองจิจูดไม่ถูกต้อง' };
  }

  const time = typeof b.time === 'string' ? b.time.trim() : '';
  const summary = typeof b.summary === 'string' ? b.summary.trim() : '';
  if (opts.requireSummary) {
    const validatedSummary = validateWorkSummary(b.summary);
    if (!validatedSummary.ok) return validatedSummary;
    return { ok: true, value: { lat, lng, time, summary: validatedSummary.value } };
  }
  if (summary.length > WORK_SUMMARY_MAX_LENGTH) {
    return { ok: false, error: 'สรุปงานวันนี้ต้องไม่เกิน 1,000 ตัวอักษร', detail: 'WORK_SUMMARY_TOO_LONG' };
  }

  return { ok: true, value: { lat, lng, time, summary: summary || undefined } };
}
