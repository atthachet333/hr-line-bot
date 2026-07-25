import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify the `x-line-signature` header for a LINE webhook request.
 *
 * @param rawBody   The exact raw request body string (must not be re-serialised).
 * @param signature The value of the `x-line-signature` header.
 * @param channelSecret The channel secret of the receiving bot.
 */
export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!signature || !channelSecret) return false;

  const expected = createHmac('sha256', channelSecret).update(rawBody).digest('base64');

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;

  try {
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}
