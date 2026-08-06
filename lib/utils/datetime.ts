/** Date / time helpers. All stored timestamps are ISO 8601 (UTC). */

export const BANGKOK_TZ = 'Asia/Bangkok';

/** Current instant as an ISO 8601 string (UTC), e.g. 2026-07-25T03:30:00.000Z. */
export function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Robust date parsing
// ---------------------------------------------------------------------------
//
// Google Sheets, when a cell is written with USER_ENTERED, silently coerces a
// value like "2026-08-06" into a *serial number* (days since 1899-12-30). Read
// back, that cell is "46787" — and `new Date("46787…")` yields the year 46787
// ("1 มกราคม 46787"). `parseSheetDate` accepts every shape a date can arrive in
// (YYYY-MM-DD, ISO datetime, Date, Google serial number, Thai text) and returns
// a Date anchored at UTC-midnight of the intended *calendar* date, so callers
// can format it without timezone drift.

const GOOGLE_EPOCH_UTC = Date.UTC(1899, 11, 30); // day 0 = 1899-12-30
// A serial in this range maps to roughly 1954–2173 — wide enough for real data,
// narrow enough that small counts (totalDays = 2) are never mistaken for a date.
const SERIAL_MIN = 20000;
const SERIAL_MAX = 100000;

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function utcMidnight(year: number, month1: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month1) || !Number.isInteger(day)) return null;
  const d = new Date(Date.UTC(year, month1 - 1, day));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Convert a Google Sheets / Excel serial number to a UTC-midnight Date. */
export function googleSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < SERIAL_MIN || serial > SERIAL_MAX) return null;
  const ms = GOOGLE_EPOCH_UTC + Math.floor(serial) * 86_400_000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse a date coming from a Google Sheet (or the app) into a UTC-midnight Date,
 * or null when it cannot be understood. Never throws.
 */
export function parseSheetDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    return googleSerialToDate(value);
  }

  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s === '') return null;

  // YYYY-MM-DD (optionally with a time component — take the calendar date part).
  const ymd = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(s);
  if (ymd) {
    return utcMidnight(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  }

  // A bare number stored as text -> Google serial.
  if (/^\d+(\.\d+)?$/.test(s)) {
    return googleSerialToDate(Number(s));
  }

  // Thai formatted date, e.g. "10 สิงหาคม 2569" (Buddhist year).
  const thai = /^(\d{1,2})\s+([ก-๙]+)\s+(\d{3,4})$/.exec(s);
  if (thai) {
    const month = THAI_MONTHS.indexOf(thai[2]);
    if (month !== -1) {
      let year = Number(thai[3]);
      if (year > 2400) year -= 543; // BE -> CE
      return utcMidnight(year, month + 1, Number(thai[1]));
    }
  }

  // Full ISO datetime with a non-YMD-prefixed form — last resort.
  if (/[T]/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      // Anchor to the Bangkok calendar date so it doesn't drift.
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: BANGKOK_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parts);
      if (m) return utcMidnight(Number(m[1]), Number(m[2]), Number(m[3]));
    }
  }

  return null;
}

/** UTC-midnight Date -> "YYYY-MM-DD" (uses UTC parts, so no timezone drift). */
export function toYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Normalise any sheet date value to "YYYY-MM-DD", or "" when unparseable. */
export function sheetDateToYmd(value: unknown): string {
  const d = parseSheetDate(value);
  return d ? toYmd(d) : '';
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format an ISO timestamp for humans in the Asia/Bangkok timezone,
 * e.g. "25 กรกฎาคม 2569 เวลา 10:30 น.". Returns "-" for an unparseable value.
 */
export function formatThaiDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
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
 * Format a date (YYYY-MM-DD, ISO, Date, or Google serial) in Thai with the
 * Buddhist year, e.g. "10 สิงหาคม 2569". Returns "-" when it cannot be parsed —
 * never a garbage year like 46787.
 */
export function formatThaiDate(value: unknown): string {
  const d = parseSheetDate(value);
  if (!d) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

function bangkokDayOfMonthUtc(d: Date): string {
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', day: 'numeric' }).format(d);
}

/**
 * Format an inclusive date range in Thai. Same-month ranges collapse, e.g.
 * "10–11 สิงหาคม 2569". Returns "-" when either endpoint is unparseable.
 */
export function formatThaiDateRange(startValue: unknown, endValue: unknown): string {
  const start = parseSheetDate(startValue);
  const end = parseSheetDate(endValue);
  if (!start || !end) return '-';

  const startYmd = toYmd(start);
  const endYmd = toYmd(end);
  if (startYmd === endYmd) return formatThaiDate(start);

  const monthYear = (d: Date) =>
    new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(d);

  if (monthYear(start) === monthYear(end)) {
    return `${bangkokDayOfMonthUtc(start)}–${formatThaiDate(end)}`;
  }
  return `${formatThaiDate(start)} – ${formatThaiDate(end)}`;
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
