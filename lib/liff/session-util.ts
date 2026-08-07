/**
 * Pure helpers for the LIFF session layer (no `liff` import, unit-testable).
 */

/**
 * Legacy → canonical pathname map. If the LIFF app's Endpoint URL (LINE console)
 * still points at an old path, we normalise it so the login round-trip returns
 * to the REAL route. One-directional only — canonical paths are never remapped.
 */
const LEGACY_PATHNAME_MAP: Record<string, string> = {
  '/liff/clock-in': '/liff/checkin',
  '/liff/clock-out': '/liff/checkout',
  '/clock-in': '/liff/checkin',
  '/clock-out': '/liff/checkout',
  '/liff/check-in': '/liff/checkin',
  '/liff/check-out': '/liff/checkout',
  '/checkin': '/liff/checkin',
  '/checkout': '/liff/checkout',
};

/** Map a legacy pathname to its canonical route (identity for canonical paths). */
export function canonicalPathname(pathname: string): string {
  return LEGACY_PATHNAME_MAP[pathname] ?? pathname;
}

/**
 * Sanitize a URL for use as a LIFF `redirectUri`: origin + CANONICAL pathname
 * only, dropping the query string and hash so no transient/sensitive params (or
 * an old LIFF callback) are carried back into the login round-trip. Legacy
 * clock-in/clock-out (or check-in/check-out) paths are normalised to the real
 * /liff/checkin and /liff/checkout so login never returns to a dead path.
 */
export function sanitizeRedirectUri(href: string): string {
  try {
    const u = new URL(href);
    return `${u.origin}${canonicalPathname(u.pathname)}`;
  } catch {
    return href;
  }
}

/** Mask a LIFF id for diagnostics — keep only the numeric channel prefix. */
export function maskLiffId(id: string | undefined | null): string {
  if (!id) return '';
  const s = String(id);
  const dash = s.indexOf('-');
  const prefix = dash === -1 ? s.slice(0, 4) : s.slice(0, dash);
  return `${prefix}-…`;
}
