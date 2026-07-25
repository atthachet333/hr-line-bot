import { randomUUID } from 'crypto';

/** Generate a correlation id for tracing a single request across logs. */
export function newCorrelationId(): string {
  return `cid-${randomUUID()}`;
}

/**
 * Derive a correlation id for a request: reuse an inbound `x-correlation-id`
 * header when present (and reasonable), otherwise mint a new one.
 */
export function correlationIdFrom(req: Request): string {
  const header = req.headers.get('x-correlation-id');
  if (header && header.length <= 128 && /^[\w.\-:]+$/.test(header)) return header;
  return newCorrelationId();
}
