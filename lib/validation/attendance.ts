import type { ValidationResult } from './leave';

export interface AttendanceInput {
  lat: number;
  lng: number;
  time: string;
  summary?: string;
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
): ValidationResult<AttendanceInput> {
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

  if (opts.requireSummary && !summary) {
    return { ok: false, error: 'กรุณาระบุสรุปงานประจำวัน' };
  }
  if (summary.length > 2000) {
    return { ok: false, error: 'สรุปงานยาวเกินไป' };
  }

  return { ok: true, value: { lat, lng, time, summary: summary || undefined } };
}
