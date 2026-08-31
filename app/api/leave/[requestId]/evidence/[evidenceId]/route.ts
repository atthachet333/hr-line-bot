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
import * as evidenceRepo from '@/lib/repositories/leave-evidence-repository';
import * as auditLog from '@/lib/repositories/audit-log-repository';
import { readEvidence } from '@/lib/evidence/storage';
import { LEGACY_EVIDENCE_ID } from '@/lib/evidence/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ROUTE = 'GET /api/leave/:id/evidence/:evidenceId';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ requestId: string; evidenceId: string }> },
): Promise<NextResponse> {
  const correlationId = correlationIdFrom(req);
  try {
    const { requestId, evidenceId } = await ctx.params;
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
    let relativePath = '';
    let mimeType = '';
    let originalName = '';
    if (evidenceId === LEGACY_EVIDENCE_ID) {
      const legacy = found.request;
      if (legacy.evidenceStatus !== 'AVAILABLE' || !legacy.evidenceRelativePath) {
        throw new NotFoundError('ไม่มีหลักฐานแนบสำหรับคำขอนี้');
      }
      relativePath = legacy.evidenceRelativePath;
      mimeType = legacy.evidenceMimeType;
      originalName = legacy.evidenceOriginalFileName || legacy.evidenceStoredFileName;
    } else {
      const item = await evidenceRepo.findByEvidenceId(requestId, evidenceId);
      if (!item) throw new NotFoundError('ไม่พบหลักฐานนี้');
      relativePath = item.relativePath;
      mimeType = item.mimeType;
      originalName = item.originalName || item.storedName;
    }
    const bytes = await readEvidence(env.leaveEvidenceDir(), relativePath);
    if (!bytes) throw new NotFoundError('ไม่พบไฟล์หลักฐาน');
    await auditLog.append({
      requestId, action: 'EVIDENCE_VIEWED', actorLineUserId: actorUserId,
      actorName: authz.actorType, detail: `evidenceId=${evidenceId.slice(0, 40)}`,
    });
    logger.info('evidence_viewed', {
      route: ROUTE, correlationId, leaveRequestId: requestId,
      actorType: authz.actorType === 'hr_admin' ? 'hr_admin' : 'manager',
      actorUserIdMasked: maskId(actorUserId), result: 'ok',
    });
    const filename = encodeURIComponent(originalName || 'evidence');
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename*=UTF-8''${filename}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; object-src 'none'; frame-ancestors 'self'",
      },
    });
  } catch (error) {
    return fail(error, correlationId, { route: ROUTE });
  }
}
