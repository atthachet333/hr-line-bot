/**
 * Central LIFF configuration. One source of truth for:
 *  - which NEXT_PUBLIC LIFF id each page uses,
 *  - the canonical in-app route path for each page,
 *  - the production URLs used by the Rich Menu.
 *
 * NEXT_PUBLIC_* vars must be referenced as literal `process.env.NEXT_PUBLIC_*`
 * so Next.js can inline them into the client bundle — hence the explicit map.
 */

export type LiffPage = 'checkin' | 'checkout' | 'leave' | 'balance' | 'evidence';

/** Employee-facing pages that MUST each have a configured LIFF id (validated). */
export const LIFF_PAGES: LiffPage[] = ['checkin', 'checkout', 'leave', 'balance'];

/** Canonical in-app route for each page (the routes that actually exist). */
export const CANONICAL_PATHS: Record<LiffPage, string> = {
  checkin: '/liff/checkin',
  checkout: '/liff/checkout',
  leave: '/liff/leave',
  balance: '/liff/balance',
  evidence: '/liff/evidence',
};

/** Production origin that the Rich Menu / LIFF endpoint URLs point at. */
export const PRODUCTION_ORIGIN = 'https://s2aline.s2aconsultant.com';

// Literal env references so Next inlines them client-side. Leave falls back to
// the legacy NEXT_PUBLIC_LIFF_ID when a leave-specific var is not set.
const LIFF_ID_BY_PAGE: Record<LiffPage, string> = {
  checkin: process.env.NEXT_PUBLIC_LIFF_ID_CHECKIN ?? '',
  checkout: process.env.NEXT_PUBLIC_LIFF_ID_CHECKOUT ?? '',
  leave: process.env.NEXT_PUBLIC_LIFF_ID_LEAVE ?? process.env.NEXT_PUBLIC_LIFF_ID ?? '',
  balance: process.env.NEXT_PUBLIC_LIFF_ID_BALANCE ?? '',
  // Manager/HR evidence viewer LIFF app (optional; falls back to the leave id so
  // the page still runs in-app while a dedicated manager LIFF is provisioned).
  evidence:
    process.env.NEXT_PUBLIC_LIFF_ID_EVIDENCE ??
    process.env.NEXT_PUBLIC_LIFF_ID_MANAGER ??
    process.env.NEXT_PUBLIC_LIFF_ID ??
    '',
};

/**
 * The configured LIFF id for a page, or '' when the env var is missing. Callers
 * MUST treat '' as a hard configuration error (show LIFF_INIT_FAILED) — never
 * call `liff.init` with an empty id.
 */
export function getLiffIdForPage(page: LiffPage): string {
  return LIFF_ID_BY_PAGE[page] ?? '';
}

/** True when every page has a configured LIFF id. */
export function allLiffIdsConfigured(): boolean {
  return LIFF_PAGES.every((p) => getLiffIdForPage(p).length > 0);
}

/** The canonical production URL (path route) for a page. */
export function canonicalUrl(page: LiffPage): string {
  return `${PRODUCTION_ORIGIN}${CANONICAL_PATHS[page]}`;
}

/** The LIFF deep link (https://liff.line.me/<id>) — preferred for Rich Menu. */
export function liffUrl(liffId: string): string {
  return `https://liff.line.me/${liffId}`;
}

export type MessageLiffPage = 'checkin' | 'checkout' | 'leave' | 'balance';

/**
 * Resolve a page's LIFF id from an env object AT CALL TIME (not module load) —
 * for server-side message builders (Flex / Quick Reply / cron) that run after
 * env is loaded. `leave` falls back to NEXT_PUBLIC_LIFF_ID.
 */
export function resolveLiffId(page: MessageLiffPage, env: NodeJS.ProcessEnv = process.env): string {
  const v = (s: string | undefined) => (s && s.trim() ? s.trim() : '');
  switch (page) {
    case 'checkin':
      return v(env.NEXT_PUBLIC_LIFF_ID_CHECKIN);
    case 'checkout':
      return v(env.NEXT_PUBLIC_LIFF_ID_CHECKOUT);
    case 'leave':
      return v(env.NEXT_PUBLIC_LIFF_ID_LEAVE) || v(env.NEXT_PUBLIC_LIFF_ID);
    case 'balance':
      return v(env.NEXT_PUBLIC_LIFF_ID_BALANCE);
  }
}

/**
 * Canonical LIFF deep link for a message button. This is the ONE helper every
 * Flex / Quick Reply / template button must use — never a /checkin path or a raw
 * web domain. Returns '' when the LIFF id is not configured.
 */
export function messageLiffUrl(page: MessageLiffPage, env: NodeJS.ProcessEnv = process.env): string {
  const id = resolveLiffId(page, env);
  return id ? liffUrl(id) : '';
}

/**
 * Manager/HR evidence viewer URL for a request. Uses the LIFF deep link with a
 * `?requestId=` QUERY (not a path suffix): LINE opens the LIFF base endpoint
 * (/liff/evidence) and the base page reads requestId from the query / liff.state,
 * so it never 404s on the base route. Falls back to the canonical route URL when
 * no evidence LIFF id is configured. Never hardcodes a domain.
 */
export function evidenceViewerUrl(requestId: string): string {
  const id = getLiffIdForPage('evidence');
  const q = `requestId=${encodeURIComponent(requestId)}`;
  return id ? `${liffUrl(id)}?${q}` : `${PRODUCTION_ORIGIN}${CANONICAL_PATHS.evidence}?${q}`;
}
