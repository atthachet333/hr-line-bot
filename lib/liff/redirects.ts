/**
 * Backwards-compatibility redirects so old/short URLs that may live in a Rich
 * Menu, a bookmark, or a chat history never 404. Every destination is a route
 * that actually exists under /liff/*. Used by next.config.ts.
 *
 * `permanent: false` (307) during the migration so browsers/LINE don't cache the
 * mapping while URLs are still being settled.
 */
export interface LiffRedirect {
  source: string;
  destination: string;
  permanent: boolean;
}

export function liffRedirects(): LiffRedirect[] {
  return [
    // Short paths (no /liff prefix).
    { source: '/checkin', destination: '/liff/checkin', permanent: false },
    { source: '/checkout', destination: '/liff/checkout', permanent: false },
    { source: '/leave', destination: '/liff/leave', permanent: false },
    { source: '/balance', destination: '/liff/balance', permanent: false },
    // Hyphenated variants.
    { source: '/liff/check-in', destination: '/liff/checkin', permanent: false },
    { source: '/liff/check-out', destination: '/liff/checkout', permanent: false },
    { source: '/check-in', destination: '/liff/checkin', permanent: false },
    { source: '/check-out', destination: '/liff/checkout', permanent: false },
    // Legacy LIFF endpoint paths (the old console Endpoint URL). One-directional
    // only: clock-in -> checkin, clock-out -> checkout (never the reverse).
    { source: '/liff/clock-in', destination: '/liff/checkin', permanent: false },
    { source: '/liff/clock-out', destination: '/liff/checkout', permanent: false },
    { source: '/clock-in', destination: '/liff/checkin', permanent: false },
    { source: '/clock-out', destination: '/liff/checkout', permanent: false },
  ];
}
