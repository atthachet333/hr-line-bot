/**
 * Pure presentation helpers for the attendance-history UI. No React / no I/O —
 * the canonical numbers come from `attendance-core`; this only turns them into
 * Thai display strings and picks EmploymentType-specific labels.
 */

/** "162 ชม. 35 นาที" from a minute count. Floors to whole minutes; never negative. */
export function formatMinutesThai(totalMinutes: number): string {
  const total = Number.isFinite(totalMinutes) ? Math.max(0, Math.floor(totalMinutes)) : 0;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours} ชม. ${minutes} นาที`;
}

/** Per-day duration from the item's decimal work-hours; "-" for an open day. */
export function formatWorkHours(workHours: number | null): string {
  if (workHours === null || !Number.isFinite(workHours)) return '-';
  return formatMinutesThai(Math.round(workHours * 60));
}

export type EmploymentKind = 'regular' | 'daily' | 'unknown';

/** Map the raw Employees.EmploymentType value to a known kind (blank = unknown). */
export function employmentKind(employmentType: string | null | undefined): EmploymentKind {
  const value = String(employmentType ?? '').trim();
  if (value === 'พนักงานประจำ') return 'regular';
  if (value === 'พนักงานรายวัน') return 'daily';
  return 'unknown';
}

export interface SummaryLabels {
  /** Always "วันที่ทำงาน". */
  workDaysLabel: string;
  /** "เวลาทำงานรวม" for regular/unknown, "ชั่วโมงทำงานรวม" for daily. */
  totalLabel: string;
  /** Badge/notice text for the employment type. */
  typeText: string;
  /** False when the employment type is not specified. */
  hasType: boolean;
}

/**
 * Labels for the summary card. Calculation is identical for every employee; only
 * the wording differs by EmploymentType (per the spec). A blank type never
 * errors — it shows a neutral notice and the generic labels.
 */
export function summaryLabels(employmentType: string | null | undefined): SummaryLabels {
  switch (employmentKind(employmentType)) {
    case 'daily':
      return { workDaysLabel: 'วันที่ทำงาน', totalLabel: 'ชั่วโมงทำงานรวม', typeText: 'พนักงานรายวัน', hasType: true };
    case 'regular':
      return { workDaysLabel: 'วันที่ทำงาน', totalLabel: 'เวลาทำงานรวม', typeText: 'พนักงานประจำ', hasType: true };
    default:
      return { workDaysLabel: 'วันที่ทำงาน', totalLabel: 'เวลาทำงานรวม', typeText: 'ยังไม่ได้ระบุประเภทพนักงาน', hasType: false };
  }
}
