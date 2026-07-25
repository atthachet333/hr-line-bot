import { describe, it, expect } from 'vitest';
import {
  isValidRejectReasonCode,
  rejectReasonLabel,
  sanitiseNote,
  MAX_REJECT_NOTE_LENGTH,
} from '@/lib/domain/reject-reasons';

describe('reject reasons', () => {
  it('validates allowlisted codes', () => {
    expect(isValidRejectReasonCode('BUSY_PERIOD')).toBe(true);
    expect(isValidRejectReasonCode('NOT_A_CODE')).toBe(false);
  });

  it('maps codes to Thai labels', () => {
    expect(rejectReasonLabel('INSUFFICIENT_BALANCE')).toContain('วันลาคงเหลือ');
    expect(rejectReasonLabel('unknown')).toBe('ไม่อนุมัติ');
  });

  it('sanitises and caps notes', () => {
    expect(sanitiseNote('  hello   world ')).toBe('hello world');
    expect(sanitiseNote('x'.repeat(1000)).length).toBe(MAX_REJECT_NOTE_LENGTH);
    expect(sanitiseNote(undefined)).toBe('');
  });
});
