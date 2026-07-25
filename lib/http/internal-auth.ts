import { timingSafeEqual } from 'crypto';
import { env } from '@/lib/env';
import { AuthenticationError, ServiceUnavailableError } from '@/lib/errors';

/**
 * Authorise an internal admin request using a shared secret (timing-safe).
 * Accepts `Authorization: Bearer <secret>` or `x-internal-secret: <secret>`.
 * Throws when the secret is not configured or does not match.
 */
export function requireInternalAuth(req: Request): void {
  const configured = env.internalApiSecret();
  if (!configured) {
    throw new ServiceUnavailableError('Internal API is not configured');
  }

  const header = req.headers.get('authorization');
  const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7) : undefined;
  const provided = bearer ?? req.headers.get('x-internal-secret') ?? '';

  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  const equal = a.length === b.length && timingSafeEqual(a, b);
  if (!equal) {
    throw new AuthenticationError('Unauthorised');
  }
}
