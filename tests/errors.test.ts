import { describe, it, expect } from 'vitest';
import {
  toErrorEnvelope,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  RateLimitError,
  ExternalServiceError,
  BusinessRuleError,
} from '@/lib/errors';

describe('error envelope mapping', () => {
  it('maps typed errors to the right status + code, hiding detail', () => {
    const cases: Array<[Error, number, string]> = [
      [new ValidationError('bad'), 400, 'VALIDATION_ERROR'],
      [new AuthenticationError('no'), 401, 'AUTHENTICATION_ERROR'],
      [new AuthorizationError('deny'), 403, 'AUTHORIZATION_ERROR'],
      [new RateLimitError('slow'), 429, 'RATE_LIMITED'],
      [new ExternalServiceError('boom', 'stack-detail'), 502, 'EXTERNAL_SERVICE_ERROR'],
    ];
    for (const [err, status, code] of cases) {
      const out = toErrorEnvelope(err, 'cid-1');
      expect(out.status).toBe(status);
      expect(out.body.code).toBe(code);
      expect(out.body.correlationId).toBe('cid-1');
      expect(JSON.stringify(out.body)).not.toContain('stack-detail');
    }
  });

  it('ConflictError carries a specific code', () => {
    const out = toErrorEnvelope(new ConflictError('dup', 'OVERLAPPING_LEAVE_REQUEST'), 'cid');
    expect(out.status).toBe(409);
    expect(out.body.code).toBe('OVERLAPPING_LEAVE_REQUEST');
  });

  it('BusinessRuleError carries custom code + status', () => {
    const out = toErrorEnvelope(new BusinessRuleError('INSUFFICIENT_LEAVE_BALANCE', 'no balance'), 'cid');
    expect(out.status).toBe(400);
    expect(out.body.code).toBe('INSUFFICIENT_LEAVE_BALANCE');
  });

  it('unknown errors become 500 INTERNAL_ERROR without leaking the message', () => {
    const out = toErrorEnvelope(new Error('secret internals'), 'cid');
    expect(out.status).toBe(500);
    expect(out.body.code).toBe('INTERNAL_ERROR');
    expect(out.body.message).not.toContain('secret internals');
    expect(out.detail).toContain('secret internals'); // detail kept server-side only
  });
});
