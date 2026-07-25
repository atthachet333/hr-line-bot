import { NextResponse } from 'next/server';
import { toErrorEnvelope } from '@/lib/errors';
import { logger } from '@/lib/logger';

export interface SuccessEnvelope<T> {
  success: true;
  code: string;
  message?: string;
  correlationId: string;
  data?: T;
}

/** Build a uniform success JSON response. */
export function ok<T>(
  correlationId: string,
  code: string,
  data?: T,
  init?: { status?: number; message?: string },
): NextResponse {
  const body: SuccessEnvelope<T> = {
    success: true,
    code,
    correlationId,
    ...(init?.message ? { message: init.message } : {}),
    ...(data !== undefined ? { data } : {}),
  };
  return NextResponse.json(body, { status: init?.status ?? 200 });
}

/**
 * Convert any thrown value into a uniform error response, logging the technical
 * detail server-side (never leaking it to the client).
 */
export function fail(
  err: unknown,
  correlationId: string,
  ctx: { route: string; event?: string } = { route: 'unknown' },
): NextResponse {
  const { status, body, detail } = toErrorEnvelope(err, correlationId);
  logger.error('request_failed', {
    correlationId,
    route: ctx.route,
    event: ctx.event,
    code: body.code,
    result: 'error',
    detail: detail?.slice(0, 800),
  });
  return NextResponse.json(body, { status });
}
