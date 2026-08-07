import { NextResponse } from 'next/server';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { fail } from '@/lib/http/respond';
import { AuthenticationError, BusinessRuleError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { verifyIdentity } from '@/lib/line/identity';
import { findByLineUserId } from '@/lib/repositories/employee-repository';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';
import type { LeaveRequest } from '@/lib/domain/leave-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'GET /api/leave/history';

/** Extract the LIFF access token from the Authorization: Bearer header. */
function bearerToken(req: Request): string | undefined {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

/** Project a stored request down to the fields the history UI needs (no ids/tokens). */
function toHistoryItem(r: LeaveRequest) {
  return {
    requestId: r.requestId,
    leaveType: r.leaveType,
    startDate: r.startDate,
    endDate: r.endDate,
    totalDays: r.totalDays,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt,
    rejectedBy: r.rejectedBy,
    rejectedAt: r.rejectedAt,
    rejectedReason: r.rejectedReason,
    // Evidence indicator only — never the stored path.
    hasEvidence: r.evidenceStatus === 'AVAILABLE',
  };
}

/**
 * List the signed-in employee's own leave history.
 *
 * Identity is derived ONLY from the verified LINE access token → Employees
 * sheet. No employeeId / userId is accepted from the query string. Always
 * responds `no-store` so the tab reflects the latest status after an approval.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const correlationId = correlationIdFrom(req);
  try {
    const accessToken = bearerToken(req);
    if (!accessToken) {
      throw new AuthenticationError('กรุณาเปิดหน้านี้จากแอป LINE อีกครั้ง');
    }

    const identity = await verifyIdentity({ accessToken });
    if (!identity.ok) {
      throw new AuthenticationError('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดจากแอป LINE อีกครั้ง');
    }
    const lineUserId = identity.identity.lineUserId;

    const employee = await findByLineUserId(lineUserId);
    if (!employee) {
      throw new BusinessRuleError(
        'EMPLOYEE_NOT_LINKED',
        'ยังไม่พบการผูกบัญชีพนักงานของคุณ กรุณาติดต่อฝ่ายบุคคล',
        403,
      );
    }

    const requests = await leaveRepo.listForEmployee(lineUserId, employee.employeeId);
    const items = requests.map(toHistoryItem);

    logger.info('leave_history', {
      correlationId,
      route: ROUTE,
      actorType: 'employee',
      result: 'ok',
      count: items.length,
    });

    const res = NextResponse.json({ success: true, items, correlationId });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    const res = fail(err, correlationId, { route: ROUTE });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }
}
