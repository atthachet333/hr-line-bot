import { describe, it, expect } from 'vitest';
import {
  formatMinutesThai,
  formatWorkHours,
  employmentKind,
  summaryLabels,
} from '@/lib/attendance/attendance-format';

describe('formatMinutesThai (#17)', () => {
  it('9755 minutes -> "162 ชม. 35 นาที"', () => {
    expect(formatMinutesThai(9755)).toBe('162 ชม. 35 นาที');
  });
  it('0 -> "0 ชม. 0 นาที"', () => {
    expect(formatMinutesThai(0)).toBe('0 ชม. 0 นาที');
  });
  it('never shows decimals; floors to whole minutes', () => {
    expect(formatMinutesThai(30.5)).toBe('0 ชม. 30 นาที');
    expect(formatMinutesThai(555)).toBe('9 ชม. 15 นาที');
  });
  it('guards against negatives / NaN', () => {
    expect(formatMinutesThai(-5)).toBe('0 ชม. 0 นาที');
    expect(formatMinutesThai(Number.NaN)).toBe('0 ชม. 0 นาที');
  });
});

describe('formatWorkHours (#18)', () => {
  it('9.25 h -> "9 ชม. 15 นาที"', () => {
    expect(formatWorkHours(9.25)).toBe('9 ชม. 15 นาที');
  });
  it('null (no check-out) -> "-"', () => {
    expect(formatWorkHours(null)).toBe('-');
  });
});

describe('employmentKind / summaryLabels (#6)', () => {
  it('regular employee -> "เวลาทำงานรวม"', () => {
    const l = summaryLabels('พนักงานประจำ');
    expect(employmentKind('พนักงานประจำ')).toBe('regular');
    expect(l).toMatchObject({ workDaysLabel: 'วันที่ทำงาน', totalLabel: 'เวลาทำงานรวม', typeText: 'พนักงานประจำ', hasType: true });
  });

  it('daily employee -> "ชั่วโมงทำงานรวม" (same math, different label)', () => {
    const l = summaryLabels('พนักงานรายวัน');
    expect(employmentKind('พนักงานรายวัน')).toBe('daily');
    expect(l).toMatchObject({ workDaysLabel: 'วันที่ทำงาน', totalLabel: 'ชั่วโมงทำงานรวม', typeText: 'พนักงานรายวัน', hasType: true });
  });

  it('blank type -> generic labels + "ยังไม่ได้ระบุประเภทพนักงาน", never errors', () => {
    const l = summaryLabels('');
    expect(employmentKind('')).toBe('unknown');
    expect(l).toMatchObject({ workDaysLabel: 'วันที่ทำงาน', totalLabel: 'เวลาทำงานรวม', typeText: 'ยังไม่ได้ระบุประเภทพนักงาน', hasType: false });
  });

  it('unknown/whitespace value falls back to unknown', () => {
    expect(employmentKind('  ')).toBe('unknown');
    expect(employmentKind('ที่ปรึกษา')).toBe('unknown');
  });
});
