import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { verifyLineSignature } from '@/lib/line/signature';
import { parsePostbackData, type ParsedPostback } from '@/lib/line/postback';
import { buildRejectReasonFlex } from '@/lib/line/flex-message';
import {
  getManagerDisplayName,
  replyToManager,
  replyTextToManager,
} from '@/lib/line/manager-client';
import { sendEmployeeNotification } from '@/lib/services/notification-service';
import { atomicTransition } from '@/lib/google-apps-script/transition';
import { isAuthorisedManagerForRequest, isAllowedSource } from '@/lib/authz/manager-authorization';
import { rejectReasonLabel } from '@/lib/domain/reject-reasons';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';
import * as auditLog from '@/lib/repositories/audit-log-repository';
import { formatThaiDateTime, nowIso } from '@/lib/utils/datetime';
import { logger } from '@/lib/logger';
import type { LeaveRequest, LeaveStatus } from '@/lib/domain/leave-request';
import type { LinePostbackEvent, LineWebhookBody, LineWebhookEvent } from '@/lib/line/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/line/manager/webhook';
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS = 100;

const STATUS_TH: Record<LeaveStatus, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};

function isPostback(event: LineWebhookEvent): event is LinePostbackEvent {
  return event.type === 'postback';
}

export async function POST(req: Request): Promise<NextResponse> {
  const correlationId = correlationIdFrom(req);

  // Read raw body with a size cap (needed for signature verification).
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'unreadable body' }, { status: 400 });
  }
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  }

  const signature = req.headers.get('x-line-signature');
  if (!verifyLineSignature(rawBody, signature, env.managerChannelSecret())) {
    logger.warn('webhook_invalid_signature', { correlationId, route: ROUTE, result: 'denied' });
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let payload: LineWebhookBody;
  try {
    payload = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const events = (Array.isArray(payload.events) ? payload.events : []).slice(0, MAX_EVENTS);
  for (const event of events) {
    if (!isPostback(event)) continue; // unsupported events are acknowledged
    try {
      await handlePostback(event, correlationId);
    } catch (err) {
      // Never fail the whole webhook because of one event.
      logger.error('webhook_event_error', {
        correlationId,
        route: ROUTE,
        result: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true });
}

async function handlePostback(event: LinePostbackEvent, correlationId: string): Promise<void> {
  const webhookEventId = event.webhookEventId ?? '';
  const replyToken = event.replyToken;
  const actorUserId = event.source.userId ?? '';

  // Idempotency: skip already-processed events.
  if (webhookEventId && (await auditLog.hasWebhookEvent(webhookEventId))) return;

  // Source / group check.
  if (!isAllowedSource(event.source)) {
    logger.warn('webhook_bad_source', { correlationId, route: ROUTE, result: 'denied' });
    return;
  }

  const parsed = parsePostbackData(event.postback.data);
  if (!parsed) {
    if (replyToken) await replyTextToManager(replyToken, 'ไม่สามารถอ่านคำสั่งได้');
    return;
  }
  if (!actorUserId) return;

  const found = await leaveRepo.findByRequestId(parsed.requestId);
  if (!found) {
    if (replyToken) await replyTextToManager(replyToken, `ไม่พบคำขอ ${parsed.requestId}`);
    await auditLog.append({
      requestId: parsed.requestId,
      action: 'ACTION_NOT_FOUND',
      actorLineUserId: actorUserId,
      webhookEventId,
    });
    return;
  }
  const request = found.request;

  // Per-request authorisation (HR admin OR assigned manager).
  const authz = isAuthorisedManagerForRequest(actorUserId, request);
  if (!authz.ok) {
    await auditLog.append({
      requestId: request.requestId,
      action: 'UNAUTHORISED_ACTION',
      actorLineUserId: actorUserId,
      detail: authz.reason,
      webhookEventId,
    });
    const msg =
      authz.reason === 'no_manager_mapping'
        ? '⛔ คำขอนี้ยังไม่มีหัวหน้าที่รับผิดชอบ กรุณาให้ HR ดำเนินการ'
        : '⛔ คุณไม่มีสิทธิ์ดำเนินการคำขอนี้';
    if (replyToken) await replyTextToManager(replyToken, msg);
    return;
  }

  // Already processed — report current status, do not re-apply.
  if (request.status !== 'PENDING') {
    if (replyToken) {
      await replyTextToManager(
        replyToken,
        `คำขอ ${request.requestId} ถูกดำเนินการไปแล้ว (สถานะ: ${STATUS_TH[request.status]})`,
      );
    }
    await auditLog.append({
      requestId: request.requestId,
      action: 'DUPLICATE_ACTION',
      actorLineUserId: actorUserId,
      fromStatus: request.status,
      detail: parsed.action,
      webhookEventId,
    });
    return;
  }

  // First reject tap -> ask for a reason (no state change yet).
  if (parsed.action === 'reject') {
    if (replyToken) await replyToManager(replyToken, [buildRejectReasonFlex(request.requestId)]);
    return;
  }

  const managerName = (await getManagerDisplayName(actorUserId)) || 'หัวหน้างาน';
  await applyTransition(parsed, request, actorUserId, managerName, authz.actorType, replyToken, webhookEventId, correlationId);
}

async function applyTransition(
  parsed: Extract<ParsedPostback, { action: 'approve' | 'reject_reason' }>,
  request: LeaveRequest,
  actorUserId: string,
  managerName: string,
  actorType: 'manager' | 'hr_admin',
  replyToken: string | undefined,
  webhookEventId: string,
  correlationId: string,
): Promise<void> {
  const desiredStatus = parsed.action === 'approve' ? 'APPROVED' : 'REJECTED';
  const reason = parsed.action === 'reject_reason' ? rejectReasonLabel(parsed.reasonCode) : undefined;
  const approvalSource = actorType === 'hr_admin' ? 'HR_ADMIN' : 'LINE_MANAGER_BOT';

  const outcome = await atomicTransition({
    requestId: request.requestId,
    desiredStatus,
    actorLineUserId: actorUserId,
    actorName: managerName,
    reason,
    approvalSource,
    correlationId,
  });

  if (outcome.outcome === 'not_found') {
    if (replyToken) await replyTextToManager(replyToken, `ไม่พบคำขอ ${request.requestId}`);
    return;
  }
  if (outcome.outcome === 'already_processed') {
    const status = (outcome.currentStatus as LeaveStatus) || request.status;
    if (replyToken) {
      await replyTextToManager(
        replyToken,
        `คำขอ ${request.requestId} ถูกดำเนินการไปแล้ว (สถานะ: ${STATUS_TH[status] ?? status})`,
      );
    }
    await auditLog.append({
      requestId: request.requestId,
      action: 'DUPLICATE_ACTION',
      actorLineUserId: actorUserId,
      fromStatus: status,
      detail: parsed.action,
      webhookEventId,
    });
    return;
  }

  // outcome === 'updated'
  const at = nowIso();
  const updated: LeaveRequest = {
    ...request,
    status: desiredStatus,
    approvedBy: desiredStatus === 'APPROVED' ? managerName : request.approvedBy,
    approvedByLineUserId: desiredStatus === 'APPROVED' ? actorUserId : request.approvedByLineUserId,
    approvedAt: desiredStatus === 'APPROVED' ? at : request.approvedAt,
    rejectedBy: desiredStatus === 'REJECTED' ? managerName : request.rejectedBy,
    rejectedByLineUserId: desiredStatus === 'REJECTED' ? actorUserId : request.rejectedByLineUserId,
    rejectedAt: desiredStatus === 'REJECTED' ? at : request.rejectedAt,
    rejectedReason: desiredStatus === 'REJECTED' ? (reason ?? '') : request.rejectedReason,
    approvalSource,
  };

  await auditLog.append({
    requestId: request.requestId,
    action: desiredStatus === 'APPROVED' ? 'APPROVE' : 'REJECT',
    actorLineUserId: actorUserId,
    actorName: managerName,
    fromStatus: 'PENDING',
    toStatus: desiredStatus,
    detail: actorType === 'hr_admin' ? `HR_ADMIN_OVERRIDE ${reason ?? ''}` : (reason ?? ''),
    webhookEventId,
  });

  if (replyToken) {
    const verb = desiredStatus === 'APPROVED' ? 'อนุมัติ' : 'ไม่อนุมัติ';
    await replyTextToManager(
      replyToken,
      `บันทึกผลเรียบร้อย: คำขอ ${request.requestId} ถูก${verb}แล้ว\nเมื่อ ${formatThaiDateTime(at)}`,
    );
  }

  // Notify the employee (approval stands even if this fails).
  const notify = await sendEmployeeNotification(updated, correlationId);
  if (!notify.ok) {
    await auditLog.append({
      requestId: request.requestId,
      action: 'NOTIFY_EMPLOYEE_FAILED',
      detail: notify.error ?? '',
      webhookEventId,
    });
  }
}
