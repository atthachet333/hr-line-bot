/** Date / time helpers. All stored timestamps are ISO 8601 (UTC). */

export const BANGKOK_TZ = 'Asia/Bangkok';

/** Current instant as an ISO 8601 string (UTC), e.g. 2026-07-25T03:30:00.000Z. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Format an ISO timestamp for humans in the Asia/Bangkok timezone,
 * e.g. "25 กรกฎาคม 2026 เวลา 10:30 น.".
 */
export function formatThaiDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const datePart = date.toLocaleDateString('th-TH', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timePart = date.toLocaleTimeString('th-TH', {
    timeZone: BANGKOK_TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${datePart} เวลา ${timePart} น.`;
}

/**
 * Format a YYYY-MM-DD date for humans in Thai, e.g. "10 สิงหาคม 2569".
 * Anchors the date at Bangkok midnight so it never shifts across the UTC
 * boundary (avoids the `new Date("YYYY-MM-DD")` off-by-one).
 */
export function formatThaiDate(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return ymd;
  return date.toLocaleDateString('th-TH', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** The day-of-month for a YYYY-MM-DD date in Asia/Bangkok. */
function bangkokDayOfMonth(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return ymd;
  return date.toLocaleDateString('th-TH', { timeZone: BANGKOK_TZ, day: 'numeric' });
}

/**
 * Format an inclusive date range in Thai. When start and end fall in the same
 * month and year the range is collapsed, e.g. "10–11 สิงหาคม 2569". Otherwise
 * both endpoints are shown in full, e.g. "30 สิงหาคม 2569 – 2 กันยายน 2569".
 */
export function formatThaiDateRange(startYmd: string, endYmd: string): string {
  const start = new Date(`${startYmd}T00:00:00+07:00`);
  const end = new Date(`${endYmd}T00:00:00+07:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startYmd} – ${endYmd}`;
  }
  if (startYmd === endYmd) return formatThaiDate(startYmd);

  const monthYear = (ymd: string) =>
    new Date(`${ymd}T00:00:00+07:00`).toLocaleDateString('th-TH', {
      timeZone: BANGKOK_TZ,
      month: 'long',
      year: 'numeric',
    });

  if (monthYear(startYmd) === monthYear(endYmd)) {
    return `${bangkokDayOfMonth(startYmd)}–${formatThaiDate(endYmd)}`;
  }
  return `${formatThaiDate(startYmd)} – ${formatThaiDate(endYmd)}`;
}

/** yyyymmdd in Asia/Bangkok, used inside request ids. */
export function bangkokDateStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date); // en-CA => YYYY-MM-DD
  return parts.replace(/-/g, '');
}

/**
 * Whole-day inclusive difference between two YYYY-MM-DD strings.
 * Returns null when either date is invalid.
 */
export function inclusiveDayCount(startDate: string, endDate: string): number | null {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const diff = Math.round((end - start) / 86_400_000);
  return diff + 1;
}
