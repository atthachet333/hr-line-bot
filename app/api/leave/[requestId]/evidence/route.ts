import { NextResponse } from 'next/server';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { bearerToken } from '@/lib/http/guards';
import { fail, ok } from '@/lib/http/respond';
import { AuthenticationError, AuthorizationError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { maskId } from '@/lib/utils/mask';
import { verifyIdentity } from '@/lib/line/identity';
import { authorizeApprover } from '@/lib/authz/manager-authorization';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';
import * as evidenceRepo from '@/lib/repositories/leave-evidence-repository';
import { normalizeEvidenceItems } from '@/lib/evidence/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ROUTE = 'GET /api/leave/:id/evidence';

/** Return safe evidence metadata. Binary files are streamed by the child route. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ requestId: string }> },
): Promise<NextResponse> {
  const correlationId = correlationIdFrom(req);
  try {
    const { requestId } = await ctx.params;
    const token = bearerToken(req);
    if (!token) throw new AuthenticationError('กรุณาเปิดหน้านี้จากแอป LINE อีกครั้ง');
    const identity = await verifyIdentity({ accessToken: token });
    if (!identity.ok) throw new AuthenticationError('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดจากแอป LINE อีกครั้ง');
    const actorUserId = identity.identity.lineUserId;
    const authz = authorizeApprover(actorUserId);
    if (!authz.ok) {
      logger.warn('evidence_view_denied', {
        route: ROUTE, correlationId, leaveRequestId: requestId,
        actorUserIdMasked: maskId(actorUserId), result: 'denied',
      });
      throw new AuthorizationError('คุณไม่มีสิทธิ์ดูหลักฐานของคำขอนี้');
    }
    const found = await leaveRepo.findByRequestId(requestId);
    if (!found) throw new NotFoundError('ไม่พบคำขอลานี้');
    const items = normalizeEvidenceItems(found.request, await evidenceRepo.listByRequestId(requestId));
    if (items.length === 0) throw new NotFoundError('ไม่มีหลักฐานแนบสำหรับคำขอนี้');
    return ok(correlationId, 'EVIDENCE_LIST', { requestId, items });
  } catch (error) {
    return fail(error, correlationId, { route: ROUTE });
  }
}
