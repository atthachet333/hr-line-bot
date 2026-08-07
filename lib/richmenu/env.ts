/**
 * Pure helpers for the Rich Menu scripts (no env captured at module-load, no
 * LINE calls) so they can be unit-tested and so callers control WHEN env is
 * read — the scripts must call `loadEnvConfig(process.cwd())` (from @next/env)
 * first, then read via these functions.
 */

export const RICH_MENU_PRODUCTION_ORIGIN = 'https://s2aline.s2aconsultant.com';

export interface RichMenuLiff {
  checkin: string;
  checkout: string;
  leave: string;
  balance: string;
}

/** Resolve each page's LIFF id from an env object (leave falls back to NEXT_PUBLIC_LIFF_ID). */
export function richMenuLiffByPage(env: NodeJS.ProcessEnv = process.env): RichMenuLiff {
  const val = (v: string | undefined) => (v && v.trim() ? v.trim() : '');
  return {
    checkin: val(env.NEXT_PUBLIC_LIFF_ID_CHECKIN),
    checkout: val(env.NEXT_PUBLIC_LIFF_ID_CHECKOUT),
    leave: val(env.NEXT_PUBLIC_LIFF_ID_LEAVE) || val(env.NEXT_PUBLIC_LIFF_ID),
    balance: val(env.NEXT_PUBLIC_LIFF_ID_BALANCE),
  };
}

export interface RichMenuDiagnostics {
  /** True when the EMPLOYEE channel access token is present — value never exposed. */
  tokenConfigured: boolean;
  liffConfiguredCount: number;
  channelRole: 'employee';
  /** Pages whose LIFF id is missing. */
  missing: Array<keyof RichMenuLiff>;
}

/**
 * Safe diagnostics for the Rich Menu scripts. The Rich Menu belongs to the
 * EMPLOYEE bot (น้องถ้วยฟู), so it uses EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN — never
 * the manager token. Only a boolean about the token is exposed.
 */
export function richMenuDiagnostics(env: NodeJS.ProcessEnv = process.env): RichMenuDiagnostics {
  const liff = richMenuLiffByPage(env);
  const entries = Object.entries(liff) as Array<[keyof RichMenuLiff, string]>;
  const token = env.EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN;
  return {
    tokenConfigured: !!(token && token.trim()),
    liffConfiguredCount: entries.filter(([, v]) => v.length > 0).length,
    channelRole: 'employee',
    missing: entries.filter(([, v]) => v.length === 0).map(([k]) => k),
  };
}

/** LIFF deep link for an id (pure — no env). */
export function liffDeepLink(liffId: string): string {
  return `https://liff.line.me/${liffId}`;
}

// ---- Rich Menu area / image geometry validation (pure) ----

export interface RichMenuBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RichMenuArea {
  bounds: RichMenuBounds;
  action: { type?: string; label?: string; uri?: string };
}

function overlaps(a: RichMenuBounds, b: RichMenuBounds): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Validate that every area is inside the menu, has positive size, and no two
 * areas overlap. Returns a list of human-readable errors (empty = valid).
 */
export function validateRichMenuAreas(
  size: { width: number; height: number },
  areas: RichMenuArea[],
): string[] {
  const errors: string[] = [];
  areas.forEach((a, i) => {
    const b = a.bounds;
    const label = a.action?.label || `#${i}`;
    if (b.width <= 0 || b.height <= 0) errors.push(`area "${label}" has non-positive size`);
    if (b.x < 0 || b.y < 0) errors.push(`area "${label}" has negative origin`);
    if (b.x + b.width > size.width) errors.push(`area "${label}" exceeds width (${b.x + b.width} > ${size.width})`);
    if (b.y + b.height > size.height) errors.push(`area "${label}" exceeds height (${b.y + b.height} > ${size.height})`);
  });
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      if (overlaps(areas[i].bounds, areas[j].bounds)) {
        const li = areas[i].action?.label || `#${i}`;
        const lj = areas[j].action?.label || `#${j}`;
        errors.push(`areas "${li}" and "${lj}" overlap`);
      }
    }
  }
  return errors;
}

/** Read PNG/JPEG pixel dimensions from a buffer, or null when unknown. */
export function readImageSize(buf: Uint8Array): { width: number; height: number } | null {
  // PNG: 8-byte signature, then IHDR with width/height as big-endian uint32.
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // JPEG: scan SOF0..SOFF (excluding non-SOF markers) for height/width.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 8 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      const len = (buf[o + 2] << 8) | buf[o + 3];
      // SOF markers carrying dimensions (skip 0xC4/0xC8/0xCC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (buf[o + 5] << 8) | buf[o + 6];
        const width = (buf[o + 7] << 8) | buf[o + 8];
        return { width, height };
      }
      o += 2 + len;
    }
  }
  return null;
}

/**
 * The set of URLs that a Rich Menu area is allowed to point at (lowercased):
 * each page's LIFF deep link plus its canonical route URL. Used to flag any
 * non-canonical area.
 */
export function expectedRichMenuUris(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const liff = richMenuLiffByPage(env);
  const set = new Set<string>();
  (Object.entries(liff) as Array<[keyof RichMenuLiff, string]>).forEach(([page, id]) => {
    if (id) set.add(liffDeepLink(id).toLowerCase());
    set.add(`${RICH_MENU_PRODUCTION_ORIGIN}/liff/${page}`.toLowerCase());
  });
  return set;
}
