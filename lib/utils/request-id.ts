import { randomUUID } from 'crypto';
import { bangkokDateStamp } from './datetime';

/**
 * Server-generated, human readable, collision-resistant request id.
 * Format: REQ-YYYYMMDD-XXXXXXXX  (date stamp in Asia/Bangkok + 8 hex chars).
 */
export function generateRequestId(): string {
  const stamp = bangkokDateStamp();
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `REQ-${stamp}-${suffix}`;
}

/** Loose validation for an incoming request id string. */
export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^REQ-\d{8}-[0-9A-Z]{8}$/.test(value);
}
