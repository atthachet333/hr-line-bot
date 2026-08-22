import { NextResponse } from 'next/server';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { bearerToken } from '@/lib/http/guards';
import { fail } from '@/lib/http/respond';
import { AuthenticationError, ValidationError } from '@/lib/errors';
import { verifyIdentity } from '@/lib/line/identity';
import { findByLineUserId } from '@/lib/repositories/employee-repository';
import { getAttendanceHistory } from '@/lib/attendance/attendance-repository';
import { calculateAttendanceSummary } from '@/lib/attendance/attendance-core';
import { businessDateThailand } from '@/lib/utils/datetime';
import { logger } from '@/lib/logger';
import { maskId, maskEmployeeId } from '@/lib/utils/mask';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ROUTE = 'GET /api/attendance/history';

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

export async function GET(req: Request): Promise<NextResponse> {
  const correlationId = correlationIdFrom(req);
  try {
    const token = bearerToken(req);
    if (!token) {
      logger.warn('attendance_history_identity', { route: ROUTE, correlationId, failureStage: 'no_token', tokenPresent: false });
      throw new AuthenticationError('กรุณาเปิดหน้านี้จากแอป LINE อีกครั้ง');
    }
    const identity = await verifyIdentity({ accessToken: token });
    if (!identity.ok) {
      logger.warn('attendance_history_identity', { route: ROUTE, correlationId, failureStage: 'line_verify', tokenPresent: true, lineVerifyOk: false });
      throw new AuthenticationError('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดจากแอป LINE อีกครั้ง');
    }
    const employee = await findByLineUserId(identity.identity.lineUserId);
    logger.info('attendance_history_identity', {
      route: ROUTE, correlationId, failureStage: employee ? 'none' : 'employee_lookup',
      tokenPresent: true, lineVerifyOk: true,
      lineUserIdMasked: maskId(identity.identity.lineUserId),
      employeeFound: Boolean(employee),
      employeeIdMasked: maskEmployeeId(employee?.employeeId),
      employmentTypePresent: Boolean(employee?.employmentType?.trim()),
    });
    if (!employee) {
      // A linked-account problem is NOT a token/session expiry — return a distinct
      // code (HTTP 200) so the client shows the right message and does NOT bounce
      // into the LIFF re-login recovery path.
      return noStore(NextResponse.json(
        { success: false, code: 'EMPLOYEE_NOT_LINKED', correlationId },
        { status: 200 },
      ));
    }

    const url = new URL(req.url);
    const today = businessDateThailand().split('-').map(Number);
    const month = Number(url.searchParams.get('month') || today[1]);
    const year = Number(url.searchParams.get('year') || today[0]);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2200) {
      throw new ValidationError('เดือนหรือปีไม่ถูกต้อง');
    }
    const employmentType = employee.employmentType ?? '';
    const items = await getAttendanceHistory({
      lineUserId: identity.identity.lineUserId,
      employeeId: employee.employeeId,
      employmentType,
      month, year,
    });
    // Summary is computed fresh from the sheet-derived items on every request
    // (no-store) — HR edits to check-in/out times are reflected on refresh.
    const summary = calculateAttendanceSummary(items);
    return noStore(NextResponse.json({
      success: true,
      data: { month, year, employmentType, summary, items },
      correlationId,
    }));
  } catch (error) {
    return noStore(fail(error, correlationId, { route: ROUTE }));
  }
}
