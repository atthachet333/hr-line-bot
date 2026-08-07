import { createHash } from 'crypto';
import type { EvidenceErrorCode } from './types';

/**
 * Evidence file validation: allow-list of exactly four types, verified by BOTH
 * declared extension AND magic bytes (content sniffing), with a hard size cap.
 * Everything else — SVG, HTML, JS, executables, archives, Office macros — is
 * rejected because its magic bytes never match an allowed type.
 */

export interface AllowedType {
  mime: string;
  ext: string[];
  /** Returns true when `buf` begins with this type's signature. */
  matches: (buf: Uint8Array) => boolean;
}

function startsWith(buf: Uint8Array, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}

const JPEG: AllowedType = {
  mime: 'image/jpeg',
  ext: ['jpg', 'jpeg'],
  matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
};
const PNG: AllowedType = {
  mime: 'image/png',
  ext: ['png'],
  matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};
const WEBP: AllowedType = {
  mime: 'image/webp',
  ext: ['webp'],
  matches: (b) =>
    b.length >= 12 &&
    startsWith(b, [0x52, 0x49, 0x46, 0x46]) && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, // "WEBP"
};
const PDF: AllowedType = {
  mime: 'application/pdf',
  ext: ['pdf'],
  matches: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]), // "%PDF-"
};

export const ALLOWED_TYPES: AllowedType[] = [JPEG, PNG, WEBP, PDF];
export const ALLOWED_MIMES = ALLOWED_TYPES.map((t) => t.mime);

/** Sniff the content type from magic bytes; null when nothing matches. */
export function detectType(buf: Uint8Array): AllowedType | null {
  return ALLOWED_TYPES.find((t) => t.matches(buf)) ?? null;
}

/** Sanitize an original filename: basename only, no null bytes/paths, capped. */
export function sanitizeFileName(name: string): string {
  const noNull = (name ?? '').replace(/\0/g, '');
  const base = noNull.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._\- ()ก-๙]/g, '_').trim();
  return cleaned.slice(0, 120) || 'evidence';
}

function extOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileName);
  return m ? m[1].toLowerCase() : '';
}

export interface ValidatedEvidence {
  bytes: Buffer;
  mime: string;
  ext: string;
  size: number;
  sha256: string;
  originalFileName: string;
}

export type EvidenceValidationResult =
  | { ok: true; value: ValidatedEvidence }
  | { ok: false; code: Extract<EvidenceErrorCode, 'UNSUPPORTED_EVIDENCE_TYPE' | 'EVIDENCE_TOO_LARGE' | 'EVIDENCE_CONTENT_MISMATCH'> };

/**
 * Validate an uploaded evidence buffer against the allow-list, size cap, magic
 * bytes, and extension↔content agreement. Returns a normalized, hashed result.
 */
export function validateEvidence(input: {
  buffer: Uint8Array;
  fileName: string;
  claimedMime?: string;
  maxBytes: number;
}): EvidenceValidationResult {
  const bytes = Buffer.from(input.buffer);
  const size = bytes.length;

  if (size > input.maxBytes) return { ok: false, code: 'EVIDENCE_TOO_LARGE' };
  if (size === 0) return { ok: false, code: 'EVIDENCE_CONTENT_MISMATCH' };

  const detected = detectType(bytes);
  if (!detected) {
    // Bytes don't match any allowed type. If the client CLAIMED an allowed MIME,
    // the content contradicts it; otherwise it's simply an unsupported type.
    const claimedAllowed = input.claimedMime && ALLOWED_MIMES.includes(input.claimedMime);
    return { ok: false, code: claimedAllowed ? 'EVIDENCE_CONTENT_MISMATCH' : 'UNSUPPORTED_EVIDENCE_TYPE' };
  }

  const originalFileName = sanitizeFileName(input.fileName);
  const ext = extOf(originalFileName);
  // The declared extension must be one the detected type allows (extension ↔
  // content agreement). A blank extension is tolerated (content is authoritative).
  if (ext && !detected.ext.includes(ext)) {
    return { ok: false, code: 'EVIDENCE_CONTENT_MISMATCH' };
  }
  // A claimed MIME, when present, must match the sniffed type.
  if (input.claimedMime && input.claimedMime !== detected.mime && ALLOWED_MIMES.includes(input.claimedMime)) {
    return { ok: false, code: 'EVIDENCE_CONTENT_MISMATCH' };
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const canonicalExt = ext && detected.ext.includes(ext) ? ext : detected.ext[0];
  return {
    ok: true,
    value: { bytes, mime: detected.mime, ext: canonicalExt, size, sha256, originalFileName },
  };
}
