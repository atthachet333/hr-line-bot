import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  resolveWithinRoot,
  buildStoredFileName,
  buildRelativePath,
  isValidEvidenceEmployeeId,
  saveEvidence,
  readEvidence,
  deleteEvidence,
} from '@/lib/evidence/storage';

let root = '';
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'evtest-'));
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('containment + naming', () => {
  it('resolveWithinRoot blocks traversal and absolute escapes', () => {
    expect(resolveWithinRoot(root, 'S2A001/REQ-1/f.jpg')).not.toBeNull();
    expect(resolveWithinRoot(root, '../escape.jpg')).toBeNull();
    expect(resolveWithinRoot(root, '../../etc/passwd')).toBeNull();
    expect(resolveWithinRoot(root, 'S2A001/../../x')).toBeNull();
  });

  it('validates employeeId format', () => {
    expect(isValidEvidenceEmployeeId('S2A001')).toBe(true);
    expect(isValidEvidenceEmployeeId('S2A123456')).toBe(true);
    expect(isValidEvidenceEmployeeId('EMP001')).toBe(false);
    expect(isValidEvidenceEmployeeId('S2A')).toBe(false);
  });

  it('stored file name is unique and relative path nests by employee/request', () => {
    const a = buildStoredFileName('S2A001', 'REQ-20260808-AAAA1111', 'jpg');
    const b = buildStoredFileName('S2A001', 'REQ-20260808-AAAA1111', 'jpg');
    expect(a).not.toBe(b); // uuid fragment prevents collisions
    expect(a.endsWith('.jpg')).toBe(true);
    expect(buildRelativePath('S2A001', 'REQ-1', a)).toBe(`S2A001/REQ-1/${a}`);
  });
});

describe('saveEvidence / readEvidence / deleteEvidence', () => {
  const REQ_A = 'REQ-20260808-AAAA1111';
  const REQ_B = 'REQ-20260808-BBBB2222';
  const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  it('writes files separated by employee and request', async () => {
    const s1 = await saveEvidence({ root, employeeId: 'S2A001', requestId: REQ_A, bytes: data, ext: 'jpg' });
    const s2 = await saveEvidence({ root, employeeId: 'S2A007', requestId: REQ_B, bytes: data, ext: 'jpg' });
    expect(s1.relativePath.startsWith('S2A001/REQ-20260808-AAAA1111/')).toBe(true);
    expect(s2.relativePath.startsWith('S2A007/REQ-20260808-BBBB2222/')).toBe(true);
    // File exists and round-trips.
    const back = await readEvidence(root, s1.relativePath);
    expect(back?.equals(data)).toBe(true);
    // Reading via a traversal path is refused.
    expect(await readEvidence(root, '../x')).toBeNull();
    // Absolute path is never leaked into the relative path.
    expect(s1.relativePath).not.toContain(root);
  });

  it('two uploads for the same request do not collide', async () => {
    const s1 = await saveEvidence({ root, employeeId: 'S2A001', requestId: REQ_A, bytes: data, ext: 'jpg' });
    const s2 = await saveEvidence({ root, employeeId: 'S2A001', requestId: REQ_A, bytes: data, ext: 'jpg' });
    expect(s1.storedFileName).not.toBe(s2.storedFileName);
    expect(await readFile(s1.absolutePath)).toBeTruthy();
  });

  it('rejects an invalid employeeId', async () => {
    await expect(saveEvidence({ root, employeeId: 'EMP001', requestId: REQ_A, bytes: data, ext: 'jpg' })).rejects.toThrow();
  });

  it('deleteEvidence removes the file (containment enforced)', async () => {
    const s = await saveEvidence({ root, employeeId: 'S2A001', requestId: REQ_A, bytes: data, ext: 'jpg' });
    expect(await deleteEvidence(root, s.relativePath)).toBe(true);
    expect(await readEvidence(root, s.relativePath)).toBeNull();
    expect(await deleteEvidence(root, '../x')).toBe(false);
  });
});
