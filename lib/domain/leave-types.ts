/** Leave-type classification. Only tracked types are balance-checked. */

export type LeaveBucket = 'sick' | 'personal' | 'annual';

/** Map a leave-type label to its balance bucket, or null if not balance-tracked. */
export function leaveBucketOf(leaveType: string): LeaveBucket | null {
  const t = leaveType.trim();
  if (t.startsWith('ลาป่วย')) return 'sick';
  if (t.startsWith('ลากิจ')) return 'personal';
  if (t.startsWith('ลาพักร้อน')) return 'annual';
  return null;
}

/**
 * A leave type is recognised if it is one of the tracked buckets OR an explicit
 * "other" type (which the UI supports, e.g. "ลาอื่นๆ (ลาบวช)"). Anything else is
 * rejected as unknown.
 */
export function isRecognisedLeaveType(leaveType: string): boolean {
  const t = leaveType.trim();
  if (leaveBucketOf(t)) return true;
  return t.startsWith('ลาอื่นๆ') || t.startsWith('ลาคลอด') || t.startsWith('ลาบวช');
}
