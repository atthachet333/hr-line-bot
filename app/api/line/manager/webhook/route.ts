import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { verifyLineSignature } from '@/lib/line/signature';
import { parsePostbackData, type ParsedPostback } from '@/lib/line/postback';
import { buildRejectReasonFlex } from '@/lib/line/flex-message';
import {
  getManagerDisplayName,
  notifyManagers,
  replyToManager,
  replyTextToManager,
} from '@/lib/line/manager-client';
import {
  buildAlreadyProcessedText,
  buildApproveGroupConfirmation,
  buildRejectGroupConfirmation,
  buildTransitionFailedText,
} from '@/lib/line/manager-confirmation';
import { sendEmployeeNotification } from '@/lib/services/notification-service';
import { atomicTransition } from '@/lib/google-apps-script/transition';
import type { LineApiResult, LineMessage } from '@/lib/line/types';
import {
  authorizeApprover,
  evaluateSource,
  isConfiguredManager,
  isHRAdmin,
} from '@/lib/authz/manager-authorization';
import { rejectReasonLabel } from '@/lib/domain/reject-reasons';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';
import * as auditLog from '@/lib/repositories/audit-log-repository';
import { nowIso } from '@/lib/utils/datetime';
import { logger } from '@/lib/logger';
import { maskId } from '@/lib/utils/mask';
import type {
  LeaveRequest,
  LeaveStatus,
} from '@/lib/domain/leave-request';
import type {
  LinePostbackEvent,
  LineWebhookBody,
  LineWebhookEvent,
} from '@/lib/line/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/line/manager/webhook';
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS = 100;

function isPostback(event: LineWebhookEvent): event is LinePostbackEvent {
  return event.type === 'postback';
}

/**
 * Deliver a group-facing message. Prefer the webhook replyToken (free, in the
 * same thread); if that fails — or there is no replyToken — fall back to pushing
 * to the manager group / configured managers. Returns whether ANY delivery
 * succeeded so the caller can audit MANAGER_GROUP_CONFIRMATION_FAILED. A failed
 * confirmation NEVER rolls back the (already-committed) status change.
 */
async function deliverToGroup(
  replyToken: string | undefined,
  messages: LineMessage[],
): Promise<LineApiResult> {
  if (replyToken) {
    const replied = await replyToManager(replyToken, messages);
    if (replied.ok) return replied;
  }
  return notifyManagers(messages);
}

function textMessage(text: string): LineMessage {
  return { type: 'text', text };
}

/**
 * แสดง Group ID ชั่วคราวใน Server Terminal
 *
 * ระบบจะแสดงเฉพาะเมื่อ:
 * - Event มาจากกลุ่ม LINE
 * - event.source.groupId มีค่า
 * - MANAGER_GROUP_ID ใน .env.local ยังว่าง
 *
 * ไม่แสดง userId, token, secret หรือ raw webhook body
 */
function logManagerGroupIdForSetup(
  event: LineWebhookEvent,
  correlationId: string,
): void {
  const configuredGroupId = process.env.MANAGER_GROUP_ID?.trim();

  if (configuredGroupId) {
    return;
  }

  if (event.source?.type !== 'group') {
    return;
  }

  const groupId = event.source.groupId;

  if (!groupId) {
    return;
  }

  logger.warn('manager_group_id_detected_for_setup', {
    correlationId,
    route: ROUTE,
    eventType: event.type,
    groupId,
    instruction:
      'Copy this groupId to MANAGER_GROUP_ID in .env.local, then restart the application.',
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const correlationId = correlationIdFrom(req);

  // ต้องอ่าน Raw Body เพื่อใช้ตรวจสอบ x-line-signature
  let rawBody: string;

  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json(
      {
        error: 'unreadable body',
      },
      {
        status: 400,
      },
    );
  }

  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json(
      {
        error: 'payload too large',
      },
      {
        status: 413,
      },
    );
  }

  const signature = req.headers.get('x-line-signature');

  if (
    !verifyLineSignature(
      rawBody,
      signature,
      env.managerChannelSecret(),
    )
  ) {
    logger.warn('webhook_invalid_signature', {
      correlationId,
      route: ROUTE,
      result: 'denied',
    });

    return NextResponse.json(
      {
        error: 'invalid signature',
      },
      {
        status: 401,
      },
    );
  }

  let payload: LineWebhookBody;

  try {
    payload = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json(
      {
        error: 'invalid body',
      },
      {
        status: 400,
      },
    );
  }

  const events = (
    Array.isArray(payload.events) ? payload.events : []
  ).slice(0, MAX_EVENTS);

  for (const event of events) {
    /*
     * แสดง groupId ก่อนกรองชนิด Event
     *
     * ดังนั้นเพียงส่งข้อความธรรมดาในกลุ่ม
     * เช่น "ขอ group id"
     * ระบบก็จะแสดง Group ID ใน Terminal ได้
     */
    logManagerGroupIdForSetup(event, correlationId);

    // Event ที่ไม่ใช่ Postback: รองรับเฉพาะ whoami ในแชตส่วนตัว (ตั้งค่าสิทธิ์)
    if (!isPostback(event)) {
      try {
        await handleWhoami(event, correlationId);
      } catch (err) {
        logger.error('webhook_event_error', {
          correlationId,
          route: ROUTE,
          result: 'error',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    try {
      await handlePostback(event, correlationId);
    } catch (err) {
      // Event รายการหนึ่งล้มเหลว ไม่ควรทำให้ Webhook ทั้งชุดล้มเหลว
      logger.error('webhook_event_error', {
        correlationId,
        route: ROUTE,
        result: 'error',
        detail:
          err instanceof Error
            ? err.message
            : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
  });
}

/**
 * `whoami` helper: in a DIRECT chat with the manager bot only, reply the sender's
 * LINE user id so it can be added to MANAGER_USER_IDS / HR_ADMIN_USER_IDS. Gated
 * by ENABLE_LINE_WHOAMI. Never runs in a group/room, and never logs the full id.
 */
async function handleWhoami(event: LineWebhookEvent, correlationId: string): Promise<void> {
  if (!env.enableLineWhoami()) return;
  if (event.type !== 'message') return;
  const message = (event as { message?: { type?: string; text?: string } }).message;
  if (message?.type !== 'text' || (message.text ?? '').trim().toLowerCase() !== 'whoami') return;

  const source = event.source;
  // Direct 1:1 chat only — must never respond in a group or room.
  if (!source || source.type !== 'user') return;
  const userId = source.userId ?? '';
  const replyToken = event.replyToken;
  if (!userId || !replyToken) return;

  await replyTextToManager(
    replyToken,
    `🆔 LINE User ID ของคุณคือ:\n${userId}\n\n` +
      `ℹ️ ใช้สำหรับตั้งค่าสิทธิ์ผู้อนุมัติ (MANAGER_USER_IDS / HR_ADMIN_USER_IDS) เท่านั้น\n` +
      `กรุณาส่งค่านี้ให้ผู้ดูแลระบบ`,
  );

  logger.info('whoami_replied', {
    correlationId,
    route: ROUTE,
    sourceType: source.type,
    sourceUserIdMasked: maskId(userId),
  });
}

async function handlePostback(
  event: LinePostbackEvent,
  correlationId: string,
): Promise<void> {
  const webhookEventId = event.webhookEventId ?? '';
  const replyToken = event.replyToken;
  const actorUserId = event.source.userId ?? '';

  // ป้องกัน LINE ส่ง Event เดิมซ้ำ
  if (
    webhookEventId &&
    (await auditLog.hasWebhookEvent(webhookEventId))
  ) {
    return;
  }

  // Structured, masked diagnostic for every approval attempt (no tokens/full ids).
  const source = evaluateSource(event.source);
  const managerMatch = isConfiguredManager(actorUserId);
  const hrAdminMatch = isHRAdmin(actorUserId);
  logger.info('manager_postback_authz', {
    correlationId,
    route: ROUTE,
    eventType: 'postback',
    sourceType: source.sourceType,
    sourceUserIdMasked: maskId(actorUserId),
    sourceGroupIdMasked: maskId(event.source.groupId),
    managerMatch,
    hrAdminMatch,
    groupMatch: source.groupMatch,
    managerCount: env.managerUserIds().length,
    hrAdminCount: env.hrAdminUserIds().length,
  });

  // 1) Source gate — the event must come from the configured group (GROUP_NOT_ALLOWED).
  if (!source.allowed) {
    if (replyToken) {
      await replyTextToManager(
        replyToken,
        '⛔ กลุ่มนี้ไม่ได้รับอนุญาตให้ดำเนินการอนุมัติ กรุณาใช้กลุ่มผู้อนุมัติที่กำหนดไว้',
      );
    }
    return;
  }

  const parsed = parsePostbackData(event.postback.data);

  if (!parsed) {
    if (replyToken) {
      await replyTextToManager(
        replyToken,
        'ไม่สามารถอ่านคำสั่งได้',
      );
    }

    return;
  }

  if (!actorUserId) {
    logger.warn('webhook_missing_actor_user_id', {
      correlationId,
      route: ROUTE,
      result: 'denied',
    });

    return;
  }

  // 2) Approver gate — union of MANAGER_USER_IDS ∪ HR_ADMIN_USER_IDS (APPROVER_NOT_ALLOWED).
  const authz = authorizeApprover(actorUserId);
  if (!authz.ok) {
    await auditLog.append({
      requestId: parsed.requestId,
      action: 'UNAUTHORISED_ACTION',
      actorLineUserId: actorUserId,
      detail: 'APPROVER_NOT_ALLOWED',
      webhookEventId,
    });
    if (replyToken) {
      await replyTextToManager(
        replyToken,
        '⛔ คุณไม่มีสิทธิ์อนุมัติ กรุณาติดต่อฝ่ายบุคคลเพื่อเพิ่มสิทธิ์ผู้อนุมัติ',
      );
    }
    return;
  }

  const found = await leaveRepo.findByRequestId(
    parsed.requestId,
  );

  if (!found) {
    if (replyToken) {
      await replyTextToManager(
        replyToken,
        `ไม่พบคำขอ ${parsed.requestId}`,
      );
    }

    await auditLog.append({
      requestId: parsed.requestId,
      action: 'ACTION_NOT_FOUND',
      actorLineUserId: actorUserId,
      webhookEventId,
    });

    return;
  }

  const request = found.request;

  // คำขอถูกดำเนินการไปแล้ว ห้ามเปลี่ยนผลซ้ำ และห้ามแจ้งพนักงานซ้ำ
  if (request.status !== 'PENDING') {
    if (replyToken) {
      await replyTextToManager(replyToken, buildAlreadyProcessedText(request.status));
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

  // กดไม่อนุมัติครั้งแรก ให้แสดงเมนูเหตุผลก่อน
  if (parsed.action === 'reject') {
    if (replyToken) {
      await replyToManager(replyToken, [
        buildRejectReasonFlex(request.requestId),
      ]);
    }

    return;
  }

  /*
   * Display Name ต้องดึงจาก LINE Profile API ฝั่ง Server
   * ห้ามเชื่อชื่อที่มากับ Client หรือ Postback
   */
  // Best-effort display name from the Manager bot channel. Never throws; falls
  // back to a neutral label so a profile lookup failure can't block approval.
  const managerName =
    (await getManagerDisplayName(actorUserId)) ||
    'ผู้อนุมัติ';

  await applyTransition(
    parsed,
    request,
    actorUserId,
    managerName,
    authz.actorType,
    replyToken,
    webhookEventId,
    correlationId,
  );
}

async function applyTransition(
  parsed: Extract<
    ParsedPostback,
    {
      action: 'approve' | 'reject_reason';
    }
  >,
  request: LeaveRequest,
  actorUserId: string,
  managerName: string,
  actorType: 'manager' | 'hr_admin',
  replyToken: string | undefined,
  webhookEventId: string,
  correlationId: string,
): Promise<void> {
  const desiredStatus: Extract<
    LeaveStatus,
    'APPROVED' | 'REJECTED'
  > =
    parsed.action === 'approve'
      ? 'APPROVED'
      : 'REJECTED';

  const reason =
    parsed.action === 'reject_reason'
      ? rejectReasonLabel(parsed.reasonCode)
      : undefined;

  const approvalSource =
    actorType === 'hr_admin'
      ? 'HR_ADMIN'
      : 'LINE_MANAGER_BOT';

  // ----- Atomic transition (LockService via Apps Script) -----
  // If it fails, we must NOT claim success in the group and must NOT notify the
  // employee. The status stays whatever it was (still PENDING).
  let outcome;
  try {
    outcome = await atomicTransition({
      requestId: request.requestId,
      desiredStatus,
      actorLineUserId: actorUserId,
      actorName: managerName,
      reason,
      approvalSource,
      correlationId,
    });
  } catch (err) {
    logger.error('transition_failed', {
      correlationId,
      route: ROUTE,
      leaveRequestId: request.requestId,
      result: 'error',
      detail: err instanceof Error ? err.message : String(err),
    });
    await deliverToGroup(replyToken, [textMessage(buildTransitionFailedText(desiredStatus))]);
    await auditLog.append({
      requestId: request.requestId,
      action: 'TRANSITION_FAILED',
      actorLineUserId: actorUserId,
      detail: parsed.action,
      webhookEventId,
    });
    return;
  }

  if (outcome.outcome === 'not_found') {
    if (replyToken) {
      await replyTextToManager(
        replyToken,
        `ไม่พบคำขอ ${request.requestId}`,
      );
    }

    return;
  }

  if (outcome.outcome === 'already_processed') {
    const status =
      (outcome.currentStatus as LeaveStatus) ||
      request.status;

    if (replyToken) {
      await replyTextToManager(replyToken, buildAlreadyProcessedText(status));
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

  // outcome === updated
  const at = nowIso();

  const updated: LeaveRequest = {
    ...request,
    status: desiredStatus,

    approvedBy:
      desiredStatus === 'APPROVED'
        ? managerName
        : request.approvedBy,

    approvedByLineUserId:
      desiredStatus === 'APPROVED'
        ? actorUserId
        : request.approvedByLineUserId,

    approvedAt:
      desiredStatus === 'APPROVED'
        ? at
        : request.approvedAt,

    rejectedBy:
      desiredStatus === 'REJECTED'
        ? managerName
        : request.rejectedBy,

    rejectedByLineUserId:
      desiredStatus === 'REJECTED'
        ? actorUserId
        : request.rejectedByLineUserId,

    rejectedAt:
      desiredStatus === 'REJECTED'
        ? at
        : request.rejectedAt,

    rejectedReason:
      desiredStatus === 'REJECTED'
        ? (reason ?? '')
        : request.rejectedReason,

    approvalSource,
  };

  await auditLog.append({
    requestId: request.requestId,
    action:
      desiredStatus === 'APPROVED'
        ? 'APPROVE'
        : 'REJECT',
    actorLineUserId: actorUserId,
    actorName: managerName,
    fromStatus: 'PENDING',
    toStatus: desiredStatus,
    detail:
      actorType === 'hr_admin'
        ? `HR_ADMIN_OVERRIDE ${reason ?? ''}`.trim()
        : (reason ?? ''),
    webhookEventId,
  });

  // ----- Group confirmation (reply, with push-to-group fallback) -----
  const confirmationText =
    desiredStatus === 'APPROVED'
      ? buildApproveGroupConfirmation(updated, managerName, at)
      : buildRejectGroupConfirmation(updated, managerName, reason ?? '', at);

  const confirmation = await deliverToGroup(replyToken, [textMessage(confirmationText)]);

  await auditLog.append({
    requestId: request.requestId,
    action: confirmation.ok
      ? desiredStatus === 'APPROVED'
        ? 'MANAGER_APPROVAL_CONFIRMED'
        : 'MANAGER_REJECTION_CONFIRMED'
      : 'MANAGER_GROUP_CONFIRMATION_FAILED',
    actorLineUserId: actorUserId,
    actorName: managerName,
    detail: confirmation.ok ? '' : (confirmation.error ?? 'group confirmation failed'),
    webhookEventId,
  });

  /*
   * แจ้งผลกลับพนักงานผ่านบอทน้องถ้วยฟู (EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN)
   *
   * - ทำหลัง transition สำเร็จเท่านั้น
   * - group confirmation ล้มเหลว ต้องไม่ขวางการแจ้งพนักงาน (คนละงานกัน)
   * - หากส่งไม่สำเร็จ: สถานะ APPROVED/REJECTED คงเดิม ห้าม Rollback,
   *   บันทึก Audit Log ให้ retry endpoint ทำงานต่อได้
   */
  const notify = await sendEmployeeNotification(
    updated,
    correlationId,
  );

  if (!notify.ok) {
    await auditLog.append({
      requestId: request.requestId,
      action: 'EMPLOYEE_NOTIFICATION_FAILED',
      detail: notify.error ?? '',
      webhookEventId,
    });
  }
}