import type { NextResponse } from 'next/server';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { ok, fail } from '@/lib/http/respond';
import { requireInternalAuth } from '@/lib/http/internal-auth';
import { ConflictError, NotFoundError, BusinessRuleError } from '@/lib/errors';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';
import * as auditLog from '@/lib/repositories/audit-log-repository';
import { sendManagerNotification, MAX_NOTIFICATION_ATTEMPTS } from '@/lib/services/notification-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/internal/leave/:id/retry-manager-notification';

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

    // Manager notification is only meaningful while the request is pending.
    if (request.status !== 'PENDING') {
      throw new ConflictError('คำขอถูกดำเนินการไปแล้ว ไม่จำเป็นต้องแจ้งหัวหน้า', 'CONFLICT');
    }
    if (request.managerNotificationAttempts >= MAX_NOTIFICATION_ATTEMPTS) {
      throw new BusinessRuleError('CONFLICT', 'เกินจำนวนครั้งที่พยายามแจ้งเตือนสูงสุดแล้ว', 409);
    }

    const result = await sendManagerNotification(request, correlationId);
    await auditLog.append({
      requestId,
      action: 'RETRY_MANAGER_NOTIFICATION',
      detail: result.ok ? 'sent' : (result.error ?? 'failed'),
    });

    if (!result.ok) {
      throw new BusinessRuleError('EXTERNAL_SERVICE_ERROR', 'ส่งแจ้งเตือนหัวหน้าไม่สำเร็จ', 502);
    }
    return ok(correlationId, 'MANAGER_NOTIFICATION_SENT', { requestId });
  } catch (err) {
    return fail(err, correlationId, { route: ROUTE });
  }
}
