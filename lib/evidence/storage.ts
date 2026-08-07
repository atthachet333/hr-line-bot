import { mkdir, rename, writeFile, unlink, readFile, stat } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';

/**
 * Evidence storage on the local filesystem, OUTSIDE the repo. Layout:
 *   <root>/<employeeId>/<requestId>/<storedFileName>
 *
 * Every path is validated for containment (path.resolve + prefix check) so a
 * crafted employeeId/requestId can never escape the root. Writes are atomic
 * (temp file + rename). Absolute paths are never returned to callers that log
 * or persist — only the relative path is stored in the sheet.
 */

const EMPLOYEE_ID_RE = /^S2A\d{3,6}$/;
const REQUEST_ID_RE = /^REQ-\d{8}-[0-9A-Z]{8}$/;

export function isValidEvidenceEmployeeId(employeeId: string): boolean {
  return EMPLOYEE_ID_RE.test(employeeId);
}

/** Build the stored file name: <emp>_<req>_<UTCstamp>_<uuidfrag>.<ext>. */
export function buildStoredFileName(employeeId: string, requestId: string, ext: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const frag = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${employeeId}_${requestId}_${stamp}_${frag}.${ext}`;
}

/** employeeId/requestId/storedFileName using POSIX separators (sheet-friendly). */
export function buildRelativePath(employeeId: string, requestId: string, storedFileName: string): string {
  return `${employeeId}/${requestId}/${storedFileName}`;
}

/**
 * Resolve a relative path under `root`, returning the absolute path only when it
 * stays within the root. Returns null on any containment violation.
 */
export function resolveWithinRoot(root: string, relativePath: string): string | null {
  if (!root) return null;
  // `root` is the EXTERNAL, env-configured LEAVE_EVIDENCE_DIR (outside the repo),
  // only known at runtime. The /*turbopackIgnore*/ comments stop the build-time
  // file tracer from trying to follow these dynamic paths — without them it
  // cannot resolve the base and falls back to tracing the whole project ("whole
  // project was traced unintentionally"). They do not affect runtime behaviour;
  // the containment check below is unchanged.
  const rootAbs = path.resolve(/* turbopackIgnore: true */ root);
  const target = path.resolve(/* turbopackIgnore: true */ rootAbs, relativePath);
  const rel = path.relative(rootAbs, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

export interface SaveEvidenceInput {
  root: string;
  employeeId: string;
  requestId: string;
  bytes: Buffer;
  ext: string;
}

export interface SavedEvidence {
  storedFileName: string;
  relativePath: string;
  /** Absolute path — for internal streaming only; never store/log this. */
  absolutePath: string;
}

/** Atomically write an evidence file. Throws on containment/IO failure. */
export async function saveEvidence(input: SaveEvidenceInput): Promise<SavedEvidence> {
  if (!input.root) throw new Error('LEAVE_EVIDENCE_DIR is not configured');
  if (!isValidEvidenceEmployeeId(input.employeeId)) throw new Error('invalid employeeId for evidence path');
  if (!REQUEST_ID_RE.test(input.requestId)) throw new Error('invalid requestId for evidence path');

  const storedFileName = buildStoredFileName(input.employeeId, input.requestId, input.ext);
  const relativePath = buildRelativePath(input.employeeId, input.requestId, storedFileName);
  const absolutePath = resolveWithinRoot(input.root, relativePath);
  if (!absolutePath) throw new Error('evidence path escapes storage root');

  const dir = path.dirname(absolutePath);
  await mkdir(/* turbopackIgnore: true */ dir, { recursive: true });

  const tempPath = path.join(/* turbopackIgnore: true */ dir, `.tmp-${randomUUID()}`);
  try {
    await writeFile(/* turbopackIgnore: true */ tempPath, input.bytes, { flag: 'wx' });
    await rename(/* turbopackIgnore: true */ tempPath, absolutePath); // atomic within the same directory
  } catch (err) {
    await unlink(/* turbopackIgnore: true */ tempPath).catch(() => {});
    throw err;
  }
  return { storedFileName, relativePath, absolutePath };
}

/** Read an evidence file, enforcing containment. Returns null when missing. */
export async function readEvidence(root: string, relativePath: string): Promise<Buffer | null> {
  const abs = resolveWithinRoot(root, relativePath);
  if (!abs) return null;
  try {
    return await readFile(/* turbopackIgnore: true */ abs);
  } catch {
    return null;
  }
}

export interface EvidenceFileStat {
  mtimeMs: number;
  size: number;
}
export async function statEvidence(root: string, relativePath: string): Promise<EvidenceFileStat | null> {
  const abs = resolveWithinRoot(root, relativePath);
  if (!abs) return null;
  try {
    const s = await stat(/* turbopackIgnore: true */ abs);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}

/** Delete an evidence file (containment enforced). Returns true when removed. */
export async function deleteEvidence(root: string, relativePath: string): Promise<boolean> {
  const abs = resolveWithinRoot(root, relativePath);
  if (!abs) return false;
  try {
    await unlink(/* turbopackIgnore: true */ abs);
    return true;
  } catch {
    return false;
  }
}
