import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { bearerToken } from '@/lib/http/guards';
import { fail } from '@/lib/http/respond';
import { AuthenticationError, AuthorizationError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { maskId } from '@/lib/utils/mask';
import { verifyIdentity } from '@/lib/line/identity';
import { authorizeApprover } from '@/lib/authz/manager-authorization';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';
import * as auditLog from '@/lib/repositories/audit-log-repository';
import { readEvidence } from '@/lib/evidence/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'GET /api/leave/:id/evidence';

/**
 * Stream a leave request's evidence file — Manager/HR only.
 *
 * Auth: verified LINE access token (Bearer) → LINE userId → must be in
 * MANAGER_USER_IDS ∪ HR_ADMIN_USER_IDS. The file is streamed inline with
 * nosniff + private/no-store; the absolute path, viewer token and full userId
 * are never exposed. Every view is audited (EVIDENCE_VIEWED).
 */
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
    const r = found.request;
    if (r.evidenceStatus !== 'AVAILABLE' || !r.evidenceRelativePath) {
      throw new NotFoundError('ไม่มีหลักฐานแนบสำหรับคำขอนี้');
    }

    const bytes = await readEvidence(env.leaveEvidenceDir(), r.evidenceRelativePath);
    if (!bytes) throw new NotFoundError('ไม่พบไฟล์หลักฐาน');

    await auditLog.append({
      requestId, action: 'EVIDENCE_VIEWED', actorLineUserId: actorUserId, actorName: authz.actorType,
    });
    logger.info('evidence_viewed', {
      route: ROUTE, correlationId, leaveRequestId: requestId,
      actorType: authz.actorType === 'hr_admin' ? 'hr_admin' : 'manager',
      actorUserIdMasked: maskId(actorUserId), result: 'ok',
    });

    const filename = encodeURIComponent(r.evidenceOriginalFileName || r.evidenceStoredFileName || 'evidence');
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': r.evidenceMimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename*=UTF-8''${filename}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; object-src 'none'; frame-ancestors 'self'",
      },
    });
  } catch (err) {
    return fail(err, correlationId, { route: ROUTE });
  }
}
