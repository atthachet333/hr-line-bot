import { describe, it, expect } from 'vitest';
import { buildDailyReportFlex } from '@/lib/line/daily-report-flex';

const ENV = {
  NEXT_PUBLIC_LIFF_ID_CHECKIN: '2010618791-ybX6PWJy',
  NEXT_PUBLIC_LIFF_ID_CHECKOUT: '2010618791-9Cdcy05Z',
  NEXT_PUBLIC_LIFF_ID_BALANCE: '2010618791-6K8d8hmx',
  NEXT_PUBLIC_LIFF_ID: '2010618791-KY777Hrw',
} as unknown as NodeJS.ProcessEnv;

/** Recursively collect every uri action as {label, uri}. */
function collectUriActions(node: unknown, out: Array<{ label: string; uri: string }> = []): Array<{ label: string; uri: string }> {
  if (Array.isArray(node)) {
    for (const n of node) collectUriActions(n, out);
  } else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    const action = o.action as Record<string, unknown> | undefined;
    if (action && action.type === 'uri' && typeof action.uri === 'string') {
      out.push({ label: String(action.label ?? ''), uri: action.uri });
    }
    for (const v of Object.values(o)) collectUriActions(v, out);
  }
  return out;
}

describe('buildDailyReportFlex — message button URLs', () => {
  const actions = collectUriActions(buildDailyReportFlex(ENV));
  const byLabelIncludes = (needle: string) => actions.find((a) => a.label.includes(needle));

  it('แจ้งเข้างาน uses the CHECKIN LIFF deep link', () => {
    expect(byLabelIncludes('แจ้งเข้างาน')?.uri).toBe('https://liff.line.me/2010618791-ybX6PWJy');
  });

  it('แจ้งออกงาน uses the CHECKOUT LIFF deep link', () => {
    expect(byLabelIncludes('แจ้งออกงาน')?.uri).toBe('https://liff.line.me/2010618791-9Cdcy05Z');
  });

  it('แจ้งลา uses the LEAVE (fallback NEXT_PUBLIC_LIFF_ID) deep link', () => {
    expect(byLabelIncludes('แจ้งลา')?.uri).toBe('https://liff.line.me/2010618791-KY777Hrw');
  });

  it('เช็กสิทธิ์ uses the BALANCE LIFF deep link', () => {
    expect(byLabelIncludes('เช็กสิทธิ์')?.uri).toBe('https://liff.line.me/2010618791-6K8d8hmx');
  });

  it('has exactly 4 buttons, all canonical liff.line.me — no relative /checkin or /checkout, no web domain', () => {
    expect(actions).toHaveLength(4);
    for (const a of actions) {
      expect(a.uri.startsWith('https://liff.line.me/')).toBe(true);
      expect(a.uri).not.toMatch(/\/check-?in\b/);
      expect(a.uri).not.toMatch(/\/check-?out\b/);
      expect(a.uri).not.toContain('s2aconsultant.com');
      expect(a.uri).not.toContain('localhost');
    }
  });
});
