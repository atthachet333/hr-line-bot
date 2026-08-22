import { describe, it, expect } from 'vitest';
import {
  sanitizeHistoryOwner,
  attendanceHistoryLoginReturnUrl,
  attendanceHistoryForwardPath,
  CANONICAL_PATHS,
  PRODUCTION_ORIGIN,
} from '@/lib/liff/config';

describe('sanitizeHistoryOwner (untrusted ?from → known LIFF owner)', () => {
  it('accepts checkin / checkout', () => {
    expect(sanitizeHistoryOwner('checkin')).toBe('checkin');
    expect(sanitizeHistoryOwner('checkout')).toBe('checkout');
  });
  it('#40 defaults to checkin for unknown / missing / injected values', () => {
    expect(sanitizeHistoryOwner('attendance')).toBe('checkin');
    expect(sanitizeHistoryOwner('history')).toBe('checkin');
    expect(sanitizeHistoryOwner(null)).toBe('checkin');
    expect(sanitizeHistoryOwner('../../evil')).toBe('checkin');
  });
});

describe('attendanceHistoryLoginReturnUrl (#43 in-scope redirect — no 400)', () => {
  it('#38 checkin owner returns an in-scope /liff/checkin URL', () => {
    const url = attendanceHistoryLoginReturnUrl('checkin', 'https://s2aline.s2aconsultant.com');
    expect(url).toBe('https://s2aline.s2aconsultant.com/liff/checkin?next=attendance-history&from=checkin');
    // Must be under the checkin endpoint, never the out-of-scope history path.
    expect(url).toContain(CANONICAL_PATHS.checkin);
    expect(url).not.toContain('/liff/attendance/history');
  });

  it('#39 checkout owner returns an in-scope /liff/checkout URL', () => {
    const url = attendanceHistoryLoginReturnUrl('checkout', 'https://s2aline.s2aconsultant.com');
    expect(url).toBe('https://s2aline.s2aconsultant.com/liff/checkout?next=attendance-history&from=checkout');
    expect(url).not.toContain('/liff/attendance/history');
  });

  it('falls back to the production origin when none is supplied, no double slash', () => {
    expect(attendanceHistoryLoginReturnUrl('checkin', '')).toBe(
      `${PRODUCTION_ORIGIN}/liff/checkin?next=attendance-history&from=checkin`,
    );
    expect(attendanceHistoryLoginReturnUrl('checkin', 'https://x.example.com/')).toBe(
      'https://x.example.com/liff/checkin?next=attendance-history&from=checkin',
    );
  });
});

describe('attendanceHistoryForwardPath (owner page → history handoff)', () => {
  it('forwards only when the next marker is present, to a fixed safe path', () => {
    expect(attendanceHistoryForwardPath('?next=attendance-history&from=checkin', 'checkin'))
      .toBe('/liff/attendance/history?from=checkin');
    expect(attendanceHistoryForwardPath('next=attendance-history', 'checkout'))
      .toBe('/liff/attendance/history?from=checkout');
  });

  it('returns null for a normal page load (no marker)', () => {
    expect(attendanceHistoryForwardPath('', 'checkin')).toBeNull();
    expect(attendanceHistoryForwardPath('?x=1', 'checkin')).toBeNull();
    expect(attendanceHistoryForwardPath(null, 'checkin')).toBeNull();
  });

  it('never builds the destination from the query (no open redirect)', () => {
    const out = attendanceHistoryForwardPath('?next=attendance-history&evil=https://attacker.test', 'checkin');
    expect(out).toBe('/liff/attendance/history?from=checkin');
    expect(out).not.toContain('attacker');
  });
});

describe('#41 existing LIFF endpoints are unchanged', () => {
  it('canonical paths for the four employee pages are intact', () => {
    expect(CANONICAL_PATHS.checkin).toBe('/liff/checkin');
    expect(CANONICAL_PATHS.checkout).toBe('/liff/checkout');
    expect(CANONICAL_PATHS.leave).toBe('/liff/leave');
    expect(CANONICAL_PATHS.balance).toBe('/liff/balance');
  });
});
