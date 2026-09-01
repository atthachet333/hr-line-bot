import type { NextResponse } from 'next/server';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { readJsonBody, bearerToken } from '@/lib/http/guards';
import { ok, fail } from '@/lib/http/respond';
import { rateLimit } from '@/lib/rate-limit';
import {
  AuthenticationError,
  ConflictError,
  ExternalServiceError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { verifyIdentity } from '@/lib/line/identity';
import { validateAttendanceInput } from '@/lib/validation/attendance';
import { findByLineUserId } from '@/lib/repositories/employee-repository';
import { recordAttendance } from '@/lib/attendance/attendance-repository';
import { businessDateThailand } from '@/lib/utils/datetime';
import { logger } from '@/lib/logger';
import { maskId, maskEmployeeId } from '@/lib/utils/mask';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/attendance/check-out';

export async function POST(req: Request): Promise<NextResponse> {
  const correlationId = correlationIdFrom(req);
  try {
    const body = await readJsonBody<Record<string, unknown>>(req);

    const idToken = typeof body.idToken === 'string' ? body.idToken : undefined;
    const accessToken = (typeof body.accessToken === 'string' ? body.accessToken : undefined) ?? bearerToken(req);
    const identity = await verifyIdentity({ idToken, accessToken });
    if (!identity.ok) {
      logger.warn('attendance_checkout_identity', {
        route: ROUTE, correlationId, failureStage: 'line_verify',
        tokenPresent: Boolean(idToken || accessToken), lineVerifyOk: false,
        failureCode: 'AUTHENTICATION_ERROR',
      });
      throw new AuthenticationError('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดจากแอป LINE อีกครั้ง');
    }
    const lineUserId = identity.identity.lineUserId;

    const rl = rateLimit(`checkout:${lineUserId}`, 10, 60_000);
    if (!rl.allowed) throw new RateLimitError('ดำเนินการบ่อยเกินไป กรุณารอสักครู่');

    // Checkout is never written without a valid daily work summary. Identity
    // remains derived exclusively from the verified LINE token below.
    const validated = validateAttendanceInput(body, { requireSummary: true });
    if (!validated.ok) throw new ValidationError(validated.error, validated.detail);
    const { lat, lng, time, summary } = validated.value;

    const clientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId.slice(0, 100) : '';
    const employee = await findByLineUserId(lineUserId);
    logger.info('attendance_checkout_identity', {
      route: ROUTE, correlationId, failureStage: employee ? 'none' : 'employee_lookup',
      tokenPresent: true, lineVerifyOk: true,
      lineUserIdMasked: maskId(lineUserId),
      employeeFound: Boolean(employee),
      employeeIdMasked: maskEmployeeId(employee?.employeeId),
      employeeNamePresent: Boolean(employee?.name?.trim()),
      employmentTypePresent: Boolean(employee?.employmentType?.trim()),
    });
    // Employees.Name is authoritative when resolved; LINE nickname is fallback only.
    const displayName = employee?.name?.trim() || identity.identity.displayName || 'พนักงาน';
    const businessDate = businessDateThailand();

    const result = await recordAttendance({
      type: 'checkout',
      lineUserId,
      employeeId: employee?.employeeId ?? '',
      employmentType: employee?.employmentType ?? '',
      displayName,
      businessDate,
      time,
      lat,
      lng,
      summary,
      clientRequestId,
    });

    logger.info('attendance_lookup', {
      route: ROUTE, correlationId, event: 'checkout',
      businessDate: result.diag.businessDate,
      employeeResolved: result.diag.employeeResolved,
      candidateCount: result.diag.candidateCount,
      openCheckinFound: result.diag.openCheckinFound,
      reason: result.diag.reason,
      actorUserIdMasked: maskId(lineUserId),
      result: result.ok ? 'ok' : 'error',
    });

    if (!result.ok) {
      if (result.kind === 'validation') {
        throw new ValidationError(result.message, result.code);
      }
      if (result.kind === 'conflict') {
        throw new ConflictError(result.message, 'CONFLICT', result.code);
      }
      throw new ExternalServiceError('บันทึกเวลาออกงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', `${result.kind}: ${result.code}`);
    }

    return ok(correlationId, result.code, result.data, { message: result.message });
  } catch (err) {
    return fail(err, correlationId, { route: ROUTE });
  }
}
