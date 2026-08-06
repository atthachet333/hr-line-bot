import type { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { correlationIdFrom } from '@/lib/utils/correlation';
import { maskId } from '@/lib/utils/mask';
import { readJsonBody } from '@/lib/http/guards';
import { ok, fail } from '@/lib/http/respond';
import { rateLimit } from '@/lib/rate-limit';
import { AuthenticationError, ConflictError, RateLimitError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { verifyIdentity } from '@/lib/line/identity';
import { validateLeaveInput } from '@/lib/validation/leave';
import { findByLineUserId } from '@/lib/repositories/employee-repository';
import * as leaveRepo from '@/lib/repositories/leave-request-repository';
import * as auditLog from '@/lib/repositories/audit-log-repository';
import { loadHolidays } from '@/lib/repositories/holiday-repository';
import { computeLeaveDays } from '@/lib/services/leave-calculation-service';
import { assertSufficientBalance } from '@/lib/services/leave-balance-service';
import { sendManagerNotification } from '@/lib/services/notification-service';
import { generateRequestId } from '@/lib/utils/request-id';
import { nowIso } from '@/lib/utils/datetime';
import type { LeaveRequest } from '@/lib/domain/leave-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/leave';
const RATE_LIMIT = 10; // per user
const RATE_WINDOW_MS = 60_000;

export async function POST(req: Request): Promise<NextResponse> {
  const correlationId = correlationIdFrom(req);
  const startedAt = Date.now();
  try {
    const body = await readJsonBody<Record<string, unknown>>(req);

    // 1. Verify identity from the LINE token (never trust browser identity).
    const identity = await verifyIdentity({
      idToken: typeof body.idToken === 'string' ? body.idToken : undefined,
      accessToken: typeof body.accessToken === 'string' ? body.accessToken : undefined,
    });
    if (!identity.ok) {
      throw new AuthenticationError('ไม่สามารถยืนยันตัวตนได้ กรุณาเปิดจากแอป LINE อีกครั้ง');
    }
    const lineUserId = identity.identity.lineUserId;

    // Per-user rate limit (after identity is established).
    const rl = rateLimit(`leave:${lineUserId}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      throw new RateLimitError('มีการส่งคำขอบ่อยเกินไป กรุณารอสักครู่');
    }

    // 2. Validate request details.
    const validated = validateLeaveInput(body);
    if (!validated.ok) {
      const { ValidationError } = await import('@/lib/errors');
      throw new ValidationError(validated.error);
    }
    const input = validated.value;

    // 3. Resolve the employee server-side (identity from the Employees sheet only).
    const employee = await findByLineUserId(lineUserId);
    if (!employee) {
      logger.warn('leave_employee_not_linked', {
        route: ROUTE,
        correlationId,
        code: 'EMPLOYEE_NOT_LINKED',
        verifiedLineUserIdMasked: maskId(lineUserId),
        employeeLookupResult: 'not_found',
      });
      const { BusinessRuleError } = await import('@/lib/errors');
      throw new BusinessRuleError(
        'EMPLOYEE_NOT_LINKED',
        'บัญชี LINE นี้ยังไม่ได้เชื่อมกับข้อมูลพนักงาน กรุณาผูกบัญชีก่อนส่งคำขอลา',
        403,
      );
    }

    // 4. Idempotency: (employeeLineUserId + clientRequestId).
    const existing = await leaveRepo.findByIdempotencyKey(lineUserId, input.clientRequestId);
    if (existing) {
      const r = existing.request;
      const managerNotified = r.managerNotificationStatus === 'SENT';
      return ok(
        correlationId,
        'DUPLICATE_REQUEST',
        {
          requestId: r.requestId,
          status: r.status,
          managerNotified,
          retryable: !managerNotified,
        },
        { message: 'คำขอนี้ถูกส่งไปแล้ว' },
      );
    }

    // 5. Server-side leave-day calculation (never trust client totalDays).
    const holidays = await loadHolidays();
    const totalDays = computeLeaveDays(input.startDate, input.endDate, {
      countWeekends: env.leaveCountWeekends(),
      holidays,
    });
    if (totalDays < 1) {
      const { BusinessRuleError } = await import('@/lib/errors');
      throw new BusinessRuleError('VALIDATION_ERROR', 'ช่วงวันที่เลือกไม่มีวันทำงานที่นับเป็นวันลา');
    }

    // 6. Overlap check against active requests.
    const overlap = await leaveRepo.findOverlapping(lineUserId, input.startDate, input.endDate);
    if (overlap) {
      throw new ConflictError(
        'มีคำขอลาในช่วงวันที่ดังกล่าวแล้ว',
        'OVERLAPPING_LEAVE_REQUEST',
        `overlaps ${overlap.requestId}`,
      );
    }

    // 7. Balance check. Best-effort: an unknown leave type or a genuinely
    //    insufficient balance is rejected, but a balance source that is
    //    unavailable / not yet implemented must NOT block the request — it is
    //    logged as a warning + audit entry and the request proceeds.
    const balance = await assertSufficientBalance(lineUserId, input.leaveType, totalDays);
    if (balance.checked === false && balance.skipped) {
      logger.warn('leave_balance_check_skipped', {
        correlationId,
        route: ROUTE,
        actorType: 'employee',
        result: 'skipped',
        code: balance.skipReason,
        detail: `bucket=${balance.bucket} type=${input.leaveType}`,
      });
    }

    // 8. Persist PENDING.
    const managerTarget = env.managerGroupId() || env.managerUserIds()[0] || '';
    const requestId = generateRequestId();
    const createdAt = nowIso();
    const record: LeaveRequest = {
      requestId,
      clientRequestId: input.clientRequestId,
      employeeLineUserId: lineUserId,
      employeeId: employee.employeeId,
      employeeName: employee.name,
      position: employee.position,
      department: employee.department,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      totalDays,
      reason: input.reason,
      managerLineUserId: employee.managerLineUserId || managerTarget,
      status: 'PENDING',
      approvedBy: '',
      approvedByLineUserId: '',
      approvedAt: '',
      rejectedBy: '',
      rejectedByLineUserId: '',
      rejectedAt: '',
      rejectedReason: '',
      approvalSource: '',
      createdAt,
      updatedAt: createdAt,
      managerNotificationStatus: 'NOT_STARTED',
      managerNotificationAttempts: 0,
      managerNotificationLastAttemptAt: '',
      managerNotificationError: '',
      employeeNotificationStatus: 'NOT_STARTED',
      employeeNotificationAttempts: 0,
      employeeNotificationLastAttemptAt: '',
      employeeNotificationError: '',
    };
    await leaveRepo.create(record);
    await auditLog.append({
      requestId,
      action: 'CREATE',
      actorLineUserId: lineUserId,
      actorName: employee.name,
      toStatus: 'PENDING',
      detail: `${input.leaveType} ${input.startDate}..${input.endDate} (${totalDays}d)`,
    });
    if (balance.checked === false && balance.skipped) {
      await auditLog.append({
        requestId,
        action: 'LEAVE_BALANCE_CHECK_SKIPPED',
        actorLineUserId: lineUserId,
        actorName: employee.name,
        detail: `reason=${balance.skipReason} bucket=${balance.bucket}`,
      });
    }
    const balanceWarning = balance.checked === false && balance.skipped;

    // 9. Notify manager and return the REAL result.
    const notify = await sendManagerNotification(record, correlationId);
    logger.info('leave_created', {
      correlationId,
      route: ROUTE,
      leaveRequestId: requestId,
      actorType: 'employee',
      result: 'ok',
      durationMs: Date.now() - startedAt,
    });

    if (notify.ok) {
      return ok(
        correlationId,
        'LEAVE_REQUEST_CREATED',
        { requestId, status: 'PENDING', managerNotified: true, balanceChecked: !balanceWarning },
        { status: 201 },
      );
    }

    await auditLog.append({ requestId, action: 'NOTIFY_MANAGER_FAILED', detail: notify.error ?? '' });
    return ok(
      correlationId,
      'LEAVE_REQUEST_CREATED_NOTIFY_FAILED',
      { requestId, status: 'PENDING', managerNotified: false, retryable: true, balanceChecked: !balanceWarning },
      {
        status: 202,
        message: 'บันทึกคำขอแล้ว แต่แจ้งเตือนหัวหน้าไม่สำเร็จ ระบบจะติดตามให้ภายหลัง',
      },
    );
  } catch (err) {
    return fail(err, correlationId, { route: ROUTE });
  }
}
