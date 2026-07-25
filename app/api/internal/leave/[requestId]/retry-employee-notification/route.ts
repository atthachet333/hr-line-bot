import type { NextResponse } from 'next/server';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { ok, fail } from '@/lib/http/respond';
import { requireInternalAuth } from '@/lib/http/internal-auth';
import { ConflictError, NotFoundError, BusinessRuleError } from '@/lib/errors';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';
import * as auditLog from '@/lib/repositories/audit-log-repository';
import { sendEmployeeNotification, MAX_NOTIFICATION_ATTEMPTS } from '@/lib/services/notification-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/internal/leave/:id/retry-employee-notification';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ requestId: string }> },
): Promise<NextResponse> {
  const correlationId = correlationIdFrom(req);
  try {
    requireInternalAuth(req);
    const { requestId } = await ctx.params;

    const found = await leaveRepo.findByRequestId(requestId);
    if (!found) throw new NotFoundError('ไม่พบคำขอ');
    const request = found.request;

    // Employee result notification only applies to processed requests.
    if (request.status !== 'APPROVED' && request.status !== 'REJECTED') {
      throw new ConflictError('คำขอยังไม่ได้รับการอนุมัติหรือปฏิเสธ', 'CONFLICT');
    }
    if (request.employeeNotificationAttempts >= MAX_NOTIFICATION_ATTEMPTS) {
      throw new BusinessRuleError('CONFLICT', 'เกินจำนวนครั้งที่พยายามแจ้งเตือนสูงสุดแล้ว', 409);
    }

    const result = await sendEmployeeNotification(request, correlationId);
    await auditLog.append({
      requestId,
      action: 'RETRY_EMPLOYEE_NOTIFICATION',
      detail: result.ok ? 'sent' : (result.error ?? 'failed'),
    });

    if (!result.ok) {
      throw new BusinessRuleError('EXTERNAL_SERVICE_ERROR', 'ส่งแจ้งเตือนพนักงานไม่สำเร็จ', 502);
    }
    return ok(correlationId, 'EMPLOYEE_NOTIFICATION_SENT', { requestId });
  } catch (err) {
    return fail(err, correlationId, { route: ROUTE });
  }
}
