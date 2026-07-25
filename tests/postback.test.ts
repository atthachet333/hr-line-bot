import { describe, it, expect } from 'vitest';
import { buildPostbackData, parsePostbackData } from '@/lib/line/postback';

const requestId = 'REQ-20260725-A1B2C3D4';

describe('postback data', () => {
  it('round-trips approve', () => {
    const data = buildPostbackData('approve', requestId);
    expect(data).toBe(`action=approve&requestId=${requestId}`);
    expect(parsePostbackData(data)).toEqual({ action: 'approve', requestId });
  });

  it('round-trips reject', () => {
    const data = buildPostbackData('reject', requestId);
    expect(parsePostbackData(data)).toEqual({ action: 'reject', requestId });
  });

  it('rejects unknown actions', () => {
    expect(parsePostbackData(`action=delete&requestId=${requestId}`)).toBeNull();
  });

  it('rejects malformed request ids', () => {
    expect(parsePostbackData('action=approve&requestId=NOT-A-REQ')).toBeNull();
  });

  it('rejects missing fields', () => {
    expect(parsePostbackData('action=approve')).toBeNull();
  });

  it('parses reject_reason with a valid reason code', () => {
    const data = buildPostbackData('reject_reason', requestId, 'BUSY_PERIOD');
    expect(parsePostbackData(data)).toEqual({
      action: 'reject_reason',
      requestId,
      reasonCode: 'BUSY_PERIOD',
    });
  });

  it('rejects reject_reason with an invalid reason code', () => {
    expect(parsePostbackData(`action=reject_reason&requestId=${requestId}&reason=HACK`)).toBeNull();
  });
});
