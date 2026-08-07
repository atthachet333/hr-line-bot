import { describe, it, expect } from 'vitest';
import { businessDateThailand } from '@/lib/utils/datetime';

describe('businessDateThailand (Asia/Bangkok)', () => {
  it('returns YYYY-MM-DD for a daytime instant', () => {
    // 2026-08-10 10:00 ICT == 2026-08-10 03:00 UTC
    expect(businessDateThailand(new Date('2026-08-10T03:00:00Z'))).toBe('2026-08-10');
  });

  it('uses the Thai calendar date around midnight (no UTC roll-back)', () => {
    // 00:30 on 10 Aug in Bangkok is still 9 Aug in UTC — must be 2026-08-10.
    const nearMidnightIct = new Date('2026-08-09T17:30:00Z'); // 10 Aug 00:30 ICT
    expect(businessDateThailand(nearMidnightIct)).toBe('2026-08-10');
    // Sanity: the naive UTC slice would wrongly give 2026-08-09.
    expect(nearMidnightIct.toISOString().slice(0, 10)).toBe('2026-08-09');
  });

  it('handles just-before-midnight ICT as the same Thai day', () => {
    // 23:30 on 9 Aug ICT == 16:30 UTC on 9 Aug.
    expect(businessDateThailand(new Date('2026-08-09T16:30:00Z'))).toBe('2026-08-09');
  });

  it('rolls to the next Thai day exactly at Bangkok midnight', () => {
    // 17:00 UTC == 00:00 ICT next day.
    expect(businessDateThailand(new Date('2026-08-09T17:00:00Z'))).toBe('2026-08-10');
  });

  it('check-in and check-out compute the same business date for one working day', () => {
    const checkin = new Date('2026-08-10T02:00:00Z'); // 09:00 ICT
    const checkout = new Date('2026-08-10T11:00:00Z'); // 18:00 ICT
    expect(businessDateThailand(checkin)).toBe(businessDateThailand(checkout));
  });
});
