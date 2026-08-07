import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { Employee } from '@/lib/repositories/employee-repository';
import type { LeaveRequest } from '@/lib/domain/leave-request';
import type { EnvelopeResult } from '@/lib/google-apps-script/client';

const verifyIdentityMock = vi.fn();
vi.mock('@/lib/line/identity', () => ({ verifyIdentity: (...a: unknown[]) => verifyIdentityMock(...a) }));

const findByLineUserIdMock = vi.fn<() => Promise<Employee | null>>();
vi.mock('@/lib/repositories/employee-repository', () => ({ findByLineUserId: () => findByLineUserIdMock() }));

const createMock = vi.fn<(r: LeaveRequest) => Promise<void>>().mockResolvedValue(undefined);
const setEvidenceMetadataMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/repositories/leave-request-repository', () => ({
  findByIdempotencyKey: vi.fn().mockResolvedValue(null),
  findOverlapping: vi.fn().mockResolvedValue(null),
  create: (r: LeaveRequest) => createMock(r),
  setEvidenceMetadata: (...a: unknown[]) => setEvidenceMetadataMock(...a),
}));

vi.mock('@/lib/repositories/audit-log-repository', () => ({ append: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/repositories/holiday-repository', () => ({ loadHolidays: () => Promise.resolve(new Set<string>()) }));
vi.mock('@/lib/services/notification-service', () => ({ sendManagerNotification: vi.fn().mockResolvedValue({ ok: true }) }));

const GENEROUS_BALANCE = { sickTotal: 30, sickUsed: 0, personalTotal: 30, personalUsed: 0, annualTotal: 30, annualUsed: 0 };
const callEnvelopeMock = vi.fn<() => Promise<EnvelopeResult>>().mockResolvedValue({ ok: true, envelope: { success: true, code: 'OK', data: GENEROUS_BALANCE } });
vi.mock('@/lib/google-apps-script/client', () => ({ callAppsScriptEnvelope: (...a: unknown[]) => callEnvelopeMock(...(a as [])) }));

const saveEvidenceMock = vi.fn().mockResolvedValue({ storedFileName: 'S2A001_REQ_x.jpg', relativePath: 'S2A001/REQ/x.jpg', absolutePath: '/tmp/x' });
vi.mock('@/lib/evidence/storage', () => ({
  saveEvidence: (...a: unknown[]) => saveEvidenceMock(...a),
  isValidEvidenceEmployeeId: (id: string) => /^S2A\d{3,6}$/.test(id),
}));

import { POST } from '@/app/api/leave/route';

const EMPLOYEE: Employee = { lineUserId: 'U-e', employeeId: 'S2A001', name: 'อาร์ม', position: 'dev', department: 'IT', managerLineUserId: 'U-mgr' };
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

let seq = 0;
function form(fields: Record<string, string>, file?: { bytes: Uint8Array; name: string; type: string }): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append('evidence', new File([file.bytes as unknown as BlobPart], file.name, { type: file.type }));
  return new Request('http://localhost:3333/api/leave', { method: 'POST', headers: { authorization: 'Bearer tok' }, body: fd });
}
function baseFields(): Record<string, string> {
  seq += 1;
  return { clientRequestId: `cid-${seq}`, leaveType: 'ลาป่วย', startDate: '2026-08-10', endDate: '2026-08-11', reason: 'ปวดหัว' };
}

beforeAll(() => {
  process.env.LEAVE_EVIDENCE_DIR = '/tmp/evidence-test';
  process.env.LEAVE_EVIDENCE_MAX_BYTES = '10485760';
});
afterAll(() => {
  delete process.env.LEAVE_EVIDENCE_DIR;
  delete process.env.LEAVE_EVIDENCE_MAX_BYTES;
});
beforeEach(() => {
  vi.clearAllMocks();
  verifyIdentityMock.mockResolvedValue({ ok: true, identity: { lineUserId: 'U-e' } });
  findByLineUserIdMock.mockResolvedValue(EMPLOYEE);
  callEnvelopeMock.mockResolvedValue({ ok: true, envelope: { success: true, code: 'OK', data: GENEROUS_BALANCE } });
  createMock.mockResolvedValue(undefined);
  saveEvidenceMock.mockResolvedValue({ storedFileName: 'f.jpg', relativePath: 'S2A001/REQ/f.jpg', absolutePath: '/tmp/x' });
});

async function body(res: Response) { return (await res.json()) as Record<string, unknown>; }

describe('POST /api/leave — optional evidence (multipart)', () => {
  it('succeeds with NO file (evidence is optional)', async () => {
    const res = await POST(form(baseFields()));
    const b = await body(res);
    expect(res.status).toBe(201);
    expect((b.data as Record<string, unknown>).evidenceStatus).toBe('NONE');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(saveEvidenceMock).not.toHaveBeenCalled();
  });

  it('every leave type succeeds without a file', async () => {
    for (const t of ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน']) {
      const res = await POST(form({ ...baseFields(), leaveType: t }));
      expect(res.status).toBe(201);
    }
  });

  it('attaches a valid JPG → evidenceStatus AVAILABLE', async () => {
    const res = await POST(form(baseFields(), { bytes: JPG, name: 'note.jpg', type: 'image/jpeg' }));
    const b = await body(res);
    expect(res.status).toBe(201);
    expect(saveEvidenceMock).toHaveBeenCalledTimes(1);
    expect((b.data as Record<string, unknown>).evidenceStatus).toBe('AVAILABLE');
    const meta = setEvidenceMetadataMock.mock.calls[0][1] as { evidenceStatus: string };
    expect(meta.evidenceStatus).toBe('AVAILABLE');
  });

  it('rejects an unsupported type (SVG) with 415 and creates NOTHING', async () => {
    const svg = new TextEncoder().encode('<svg></svg>');
    const res = await POST(form(baseFields(), { bytes: svg, name: 'x.svg', type: 'image/svg+xml' }));
    const b = await body(res);
    expect(res.status).toBe(415);
    expect(b.code).toBe('UNSUPPORTED_EVIDENCE_TYPE');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects oversize with 413', async () => {
    process.env.LEAVE_EVIDENCE_MAX_BYTES = '4';
    const res = await POST(form(baseFields(), { bytes: JPG, name: 'big.jpg', type: 'image/jpeg' }));
    process.env.LEAVE_EVIDENCE_MAX_BYTES = '10485760';
    expect(res.status).toBe(413);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('keeps the request when storage fails (evidence never blocks leave)', async () => {
    saveEvidenceMock.mockRejectedValue(new Error('disk full'));
    const res = await POST(form(baseFields(), { bytes: JPG, name: 'note.jpg', type: 'image/jpeg' }));
    const b = await body(res);
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect((b.data as Record<string, unknown>).evidenceStatus).toBe('UPLOAD_FAILED');
  });
});
