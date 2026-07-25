import type { NextResponse } from 'next/server';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { readJsonBody } from '@/lib/http/guards';
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
import { callAppsScriptEnvelope } from '@/lib/google-apps-script/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/attendance/check-in';

export async function POST(req: Request): Promise<NextResponse> {
  const correlationId = correlationIdFrom(req);
  try {
    const body = await readJsonBody<Record<string, unknown>>(req);

    const identity = await verifyIdentity({
      idToken: typeof body.idToken === 'string' ? body.idToken : undefined,
      accessToken: typeof body.accessToken === 'string' ? body.accessToken : undefined,
    });
    if (!identity.ok) {
      throw new AuthenticationError('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดจากแอป LINE อีกครั้ง');
    }
    const lineUserId = identity.identity.lineUserId;

    const rl = rateLimit(`checkin:${lineUserId}`, 10, 60_000);
    if (!rl.allowed) throw new RateLimitError('ดำเนินการบ่อยเกินไป กรุณารอสักครู่');

    const validated = validateAttendanceInput(body);
    if (!validated.ok) throw new ValidationError(validated.error);
    const { lat, lng, time } = validated.value;

    const clientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId.slice(0, 100) : '';
    const employee = await findByLineUserId(lineUserId);
    const displayName = employee?.name || identity.identity.displayName || 'พนักงาน';

    const result = await callAppsScriptEnvelope({
      action: 'checkin',
      userId: lineUserId,
      displayName,
      empId: employee?.employeeId ?? '',
      time,
      lat,
      lng,
      clientRequestId,
    });

    if (!result.ok) {
      throw new ExternalServiceError('บันทึกเวลาเข้างานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', `${result.kind}: ${result.error}`);
    }
    if (!result.envelope.success) {
      // Business rule failure from Apps Script (e.g. already checked in).
      throw new ConflictError(result.envelope.message || 'ไม่สามารถบันทึกเวลาเข้างานได้', 'CONFLICT', result.envelope.code);
    }

    return ok(correlationId, result.envelope.code || 'CHECK_IN_RECORDED', result.envelope.data, {
      message: result.envelope.message ?? 'บันทึกเวลาเข้างานสำเร็จ',
    });
  } catch (err) {
    return fail(err, correlationId, { route: ROUTE });
  }
}
