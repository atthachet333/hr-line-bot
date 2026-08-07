import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { emptyEvidenceMetadata } from '@/lib/evidence/types';
import type { LeaveRequest } from '@/lib/domain/leave-request';
import type { LineApiResult } from '@/lib/line/types';
import type { FoundRequest } from '@/lib/repositories/leave-request-repository';
import type { TransitionOutcome } from '@/lib/google-apps-script/transition';

// ---- mocks ----
vi.mock('@/lib/line/signature', () => ({ verifyLineSignature: () => true }));

const hasWebhookEventMock = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
const appendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/repositories/audit-log-repository', () => ({
  hasWebhookEvent: () => hasWebhookEventMock(),
  append: (...a: unknown[]) => appendMock(...a),
}));

const findByRequestIdMock = vi.fn<() => Promise<FoundRequest | null>>();
vi.mock('@/lib/repositories/leave-request-repository', () => ({
  findByRequestId: () => findByRequestIdMock(),
}));

const atomicTransitionMock = vi.fn<() => Promise<TransitionOutcome>>();
vi.mock('@/lib/google-apps-script/transition', () => ({
  atomicTransition: () => atomicTransitionMock(),
}));

const replyToManagerMock = vi.fn<(...a: unknown[]) => Promise<LineApiResult>>();
const replyTextToManagerMock = vi.fn<(...a: unknown[]) => Promise<LineApiResult>>();
const notifyManagersMock = vi.fn<(...a: unknown[]) => Promise<LineApiResult>>();
const getManagerDisplayNameMock = vi.fn<() => Promise<string>>();
vi.mock('@/lib/line/manager-client', () => ({
  replyToManager: (...a: unknown[]) => replyToManagerMock(...(a as [])),
  replyTextToManager: (...a: unknown[]) => replyTextToManagerMock(...(a as [])),
  notifyManagers: (...a: unknown[]) => notifyManagersMock(...(a as [])),
  getManagerDisplayName: () => getManagerDisplayNameMock(),
}));

const sendEmployeeNotificationMock = vi.fn<() => Promise<LineApiResult>>();
vi.mock('@/lib/services/notification-service', () => ({
  sendEmployeeNotification: (...a: unknown[]) => sendEmployeeNotificationMock(...(a as [])),
}));

// NOTE: authorization is exercised for real (not mocked) via env, so the tests
// cover the actual union-of-lists + group gate that this change fixes.

import { POST } from '@/app/api/line/manager/webhook/route';

const REQUEST_ID = 'REQ-20260806-AAAA1111';

function pendingRequest(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    requestId: REQUEST_ID,
    clientRequestId: 'c1',
    employeeLineUserId: 'U-emp',
    employeeId: 'EMP001',
    employeeName: 'สมชาย',
    position: 'Dev',
    department: 'IT',
    leaveType: 'ลาป่วย',
    startDate: '2026-08-06',
    endDate: '2026-08-07',
    totalDays: 2,
    reason: 'ไม่สบาย',
    managerLineUserId: 'U-mgr',
    status: 'PENDING',
    approvedBy: '',
    approvedByLineUserId: '',
    approvedAt: '',
    rejectedBy: '',
    rejectedByLineUserId: '',
    rejectedAt: '',
    rejectedReason: '',
    approvalSource: '',
    createdAt: '2026-08-06T06:50:00.000Z',
    updatedAt: '2026-08-06T06:50:00.000Z',
    managerNotificationStatus: 'SENT',
    managerNotificationAttempts: 1,
    managerNotificationLastAttemptAt: '',
    managerNotificationError: '',
    employeeNotificationStatus: 'NOT_STARTED',
    employeeNotificationAttempts: 0,
    employeeNotificationLastAttemptAt: '',
    employeeNotificationError: '',
    ...emptyEvidenceMetadata(),
    ...overrides,
  };
}

function found(request: LeaveRequest): FoundRequest {
  return { request, rowNumber: 2, header: [] };
}

interface Src {
  type?: 'group' | 'user' | 'room';
  groupId?: string;
  userId?: string;
}

function webhookReq(events: unknown[]): Request {
  return new Request('http://localhost:3333/api/line/manager/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': 'sig' },
    body: JSON.stringify({ events }),
  });
}

function postbackReq(data: string, src: Src = {}): Request {
  const source = { type: 'group', groupId: 'G1', userId: 'U-mgr', ...src };
  return webhookReq([
    { type: 'postback', replyToken: 'RT', webhookEventId: 'W1', source, postback: { data }, timestamp: 1 },
  ]);
}

function messageReq(text: string, src: Src = {}): Request {
  const source = { type: 'user', userId: 'U-someone', ...src };
  return webhookReq([
    { type: 'message', replyToken: 'RT', webhookEventId: 'M1', source, message: { type: 'text', text }, timestamp: 1 },
  ]);
}

function auditActions(): string[] {
  return appendMock.mock.calls.map((c) => (c[0] as { action: string }).action);
}

const ENV_KEYS = [
  'MANAGER_LINE_CHANNEL_SECRET',
  'MANAGER_GROUP_ID',
  'MANAGER_USER_IDS',
  'HR_ADMIN_USER_IDS',
  'ENABLE_LINE_WHOAMI',
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.MANAGER_LINE_CHANNEL_SECRET = 'test-secret';
  process.env.MANAGER_GROUP_ID = 'G1';
  process.env.MANAGER_USER_IDS = 'U-mgr, U-mgr2';
  process.env.HR_ADMIN_USER_IDS = 'U-hr';
  process.env.ENABLE_LINE_WHOAMI = 'true';
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  hasWebhookEventMock.mockResolvedValue(false);
  appendMock.mockResolvedValue(undefined);
  getManagerDisplayNameMock.mockResolvedValue('คุณวิชัย');
  replyToManagerMock.mockResolvedValue({ ok: true, status: 200 });
  replyTextToManagerMock.mockResolvedValue({ ok: true, status: 200 });
  notifyManagersMock.mockResolvedValue({ ok: true, status: 200 });
  sendEmployeeNotificationMock.mockResolvedValue({ ok: true, status: 200 });
});

describe('manager webhook — approve/reject flow', () => {
  it('approves: confirms in group and notifies the employee', async () => {
    findByRequestIdMock.mockResolvedValue(found(pendingRequest()));
    atomicTransitionMock.mockResolvedValue({
      outcome: 'updated',
      previousStatus: 'PENDING',
      currentStatus: 'APPROVED',
      data: { requestId: REQUEST_ID },
    });

    await POST(postbackReq(`action=approve&requestId=${REQUEST_ID}`));

    const confirmMsg = replyToManagerMock.mock.calls[0][1] as Array<{ text: string }>;
    expect(confirmMsg[0].text).toContain('✅ อนุมัติการลาสำเร็จ');
    expect(sendEmployeeNotificationMock).toHaveBeenCalledTimes(1);
    expect(auditActions()).toContain('APPROVE');
    expect(auditActions()).toContain('MANAGER_APPROVAL_CONFIRMED');
  });

  it('rejects with a reason: confirms in group and notifies the employee', async () => {
    findByRequestIdMock.mockResolvedValue(found(pendingRequest()));
    atomicTransitionMock.mockResolvedValue({
      outcome: 'updated',
      previousStatus: 'PENDING',
      currentStatus: 'REJECTED',
      data: { requestId: REQUEST_ID },
    });

    await POST(postbackReq(`action=reject_reason&requestId=${REQUEST_ID}&reason=BUSY_PERIOD`));

    const confirmMsg = replyToManagerMock.mock.calls[0][1] as Array<{ text: string }>;
    expect(confirmMsg[0].text).toContain('❌ ไม่อนุมัติคำขอลาสำเร็จ');
    expect(confirmMsg[0].text).toContain('มีงานสำคัญในช่วงดังกล่าว');
    expect(sendEmployeeNotificationMock).toHaveBeenCalledTimes(1);
    expect(auditActions()).toContain('MANAGER_REJECTION_CONFIRMED');
  });

  it('falls back to a group push when the reply fails (status still committed)', async () => {
    findByRequestIdMock.mockResolvedValue(found(pendingRequest()));
    atomicTransitionMock.mockResolvedValue({
      outcome: 'updated',
      previousStatus: 'PENDING',
      currentStatus: 'APPROVED',
      data: { requestId: REQUEST_ID },
    });
    replyToManagerMock.mockResolvedValue({ ok: false, status: 400, error: 'reply expired' });

    await POST(postbackReq(`action=approve&requestId=${REQUEST_ID}`));

    // Push fallback used, and it carried the confirmation text.
    expect(notifyManagersMock).toHaveBeenCalledTimes(1);
    const pushMsg = notifyManagersMock.mock.calls[0][0] as Array<{ text: string }>;
    expect(pushMsg[0].text).toContain('✅ อนุมัติการลาสำเร็จ');
    // Confirmation succeeded via push; employee still notified.
    expect(auditActions()).toContain('MANAGER_APPROVAL_CONFIRMED');
    expect(sendEmployeeNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('audits MANAGER_GROUP_CONFIRMATION_FAILED when both reply and push fail, but still notifies employee', async () => {
    findByRequestIdMock.mockResolvedValue(found(pendingRequest()));
    atomicTransitionMock.mockResolvedValue({
      outcome: 'updated',
      previousStatus: 'PENDING',
      currentStatus: 'APPROVED',
      data: { requestId: REQUEST_ID },
    });
    replyToManagerMock.mockResolvedValue({ ok: false, status: 400, error: 'reply expired' });
    notifyManagersMock.mockResolvedValue({ ok: false, status: 500, error: 'push down' });

    await POST(postbackReq(`action=approve&requestId=${REQUEST_ID}`));

    expect(auditActions()).toContain('MANAGER_GROUP_CONFIRMATION_FAILED');
    // Employee notification is a separate concern — must still run.
    expect(sendEmployeeNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT claim success or notify the employee when the transition fails', async () => {
    findByRequestIdMock.mockResolvedValue(found(pendingRequest()));
    atomicTransitionMock.mockRejectedValue(new Error('apps script down'));

    await POST(postbackReq(`action=approve&requestId=${REQUEST_ID}`));

    const failMsg = replyToManagerMock.mock.calls[0][1] as Array<{ text: string }>;
    expect(failMsg[0].text).toContain('❌ ไม่สามารถ');
    expect(failMsg[0].text).not.toContain('สำเร็จ');
    expect(sendEmployeeNotificationMock).not.toHaveBeenCalled();
    expect(auditActions()).toContain('TRANSITION_FAILED');
  });

  it('a second press after the fact replies ALREADY-PROCESSED and does not re-notify', async () => {
    findByRequestIdMock.mockResolvedValue(found(pendingRequest({ status: 'APPROVED', approvedBy: 'คุณวิชัย' })));

    await POST(postbackReq(`action=approve&requestId=${REQUEST_ID}`));

    const msg = replyTextToManagerMock.mock.calls[0][1] as string;
    expect(msg).toContain('ถูกดำเนินการไปแล้ว');
    expect(atomicTransitionMock).not.toHaveBeenCalled();
    expect(sendEmployeeNotificationMock).not.toHaveBeenCalled();
    expect(auditActions()).toContain('DUPLICATE_ACTION');
  });

  it('ignores a redelivered webhook event (idempotent, no re-notify)', async () => {
    hasWebhookEventMock.mockResolvedValue(true);
    findByRequestIdMock.mockResolvedValue(found(pendingRequest()));

    await POST(postbackReq(`action=approve&requestId=${REQUEST_ID}`));

    expect(atomicTransitionMock).not.toHaveBeenCalled();
    expect(sendEmployeeNotificationMock).not.toHaveBeenCalled();
  });
});

describe('manager webhook — authorization (the reported bug)', () => {
  it('lets an HR admin approve (union includes HR_ADMIN_USER_IDS)', async () => {
    findByRequestIdMock.mockResolvedValue(found(pendingRequest()));
    atomicTransitionMock.mockResolvedValue({
      outcome: 'updated',
      previousStatus: 'PENDING',
      currentStatus: 'APPROVED',
      data: { requestId: REQUEST_ID },
    });

    await POST(postbackReq(`action=approve&requestId=${REQUEST_ID}`, { userId: 'U-hr' }));

    expect(atomicTransitionMock).toHaveBeenCalledTimes(1);
    expect(sendEmployeeNotificationMock).toHaveBeenCalledTimes(1);
    expect(auditActions()).toContain('MANAGER_APPROVAL_CONFIRMED');
  });

  it('lets a second configured manager approve even though the request is not "theirs"', async () => {
    // request.managerLineUserId is the group id — the old code blocked this.
    findByRequestIdMock.mockResolvedValue(found(pendingRequest({ managerLineUserId: 'G1' })));
    atomicTransitionMock.mockResolvedValue({
      outcome: 'updated',
      previousStatus: 'PENDING',
      currentStatus: 'APPROVED',
      data: { requestId: REQUEST_ID },
    });

    await POST(postbackReq(`action=approve&requestId=${REQUEST_ID}`, { userId: 'U-mgr2' }));

    expect(atomicTransitionMock).toHaveBeenCalledTimes(1);
  });

  it('denies APPROVER_NOT_ALLOWED for a user in neither list', async () => {
    findByRequestIdMock.mockResolvedValue(found(pendingRequest()));

    await POST(postbackReq(`action=approve&requestId=${REQUEST_ID}`, { userId: 'U-nobody' }));

    const msg = replyTextToManagerMock.mock.calls[0][1] as string;
    expect(msg).toContain('ไม่มีสิทธิ์อนุมัติ');
    expect(atomicTransitionMock).not.toHaveBeenCalled();
    // No request lookup for an unauthorised approver.
    expect(findByRequestIdMock).not.toHaveBeenCalled();
    const audit = appendMock.mock.calls.find((c) => (c[0] as { action: string }).action === 'UNAUTHORISED_ACTION');
    expect((audit?.[0] as { detail: string }).detail).toBe('APPROVER_NOT_ALLOWED');
  });

  it('denies GROUP_NOT_ALLOWED when the postback comes from another group', async () => {
    await POST(postbackReq(`action=approve&requestId=${REQUEST_ID}`, { groupId: 'C-other', userId: 'U-mgr' }));

    const msg = replyTextToManagerMock.mock.calls[0][1] as string;
    expect(msg).toContain('กลุ่มนี้ไม่ได้รับอนุญาต');
    expect(atomicTransitionMock).not.toHaveBeenCalled();
    expect(findByRequestIdMock).not.toHaveBeenCalled();
  });

  it('does not leak full userId / groupId / replyToken in logs', async () => {
    findByRequestIdMock.mockResolvedValue(found(pendingRequest()));
    atomicTransitionMock.mockResolvedValue({
      outcome: 'updated',
      previousStatus: 'PENDING',
      currentStatus: 'APPROVED',
      data: { requestId: REQUEST_ID },
    });

    await POST(postbackReq(`action=approve&requestId=${REQUEST_ID}`, { userId: 'U-mgr', groupId: 'G1' }));

    // The webhook body carries these; assert none of the mocked LINE calls or
    // audit entries recorded the raw replyToken.
    const serialized = JSON.stringify([
      ...appendMock.mock.calls,
    ]);
    expect(serialized).not.toContain('RT'); // replyToken
  });
});

describe('manager webhook — whoami', () => {
  it('replies the user id in a DIRECT chat only', async () => {
    await POST(messageReq('whoami', { type: 'user', userId: 'U-brandnew' }));
    const msg = replyTextToManagerMock.mock.calls[0][1] as string;
    expect(msg).toContain('U-brandnew');
    expect(msg).toContain('MANAGER_USER_IDS');
  });

  it('does NOT respond to whoami in a group', async () => {
    await POST(messageReq('whoami', { type: 'group', groupId: 'G1', userId: 'U-mgr' }));
    expect(replyTextToManagerMock).not.toHaveBeenCalled();
  });

  it('ignores non-whoami messages', async () => {
    await POST(messageReq('hello', { type: 'user', userId: 'U-x' }));
    expect(replyTextToManagerMock).not.toHaveBeenCalled();
  });
});
