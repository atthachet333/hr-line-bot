import { describe, it, expect } from 'vitest';
import { validateEvidence, sanitizeFileName, detectType } from '@/lib/evidence/validate';

const MAX = 10 * 1024 * 1024;

function bytes(sig: number[], padTo = 32): Uint8Array {
  const b = new Uint8Array(padTo);
  b.set(sig, 0);
  return b;
}
const JPG = bytes([0xff, 0xd8, 0xff, 0xe0]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = bytes([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
function webp(): Uint8Array {
  const b = new Uint8Array(16);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return b;
}

describe('validateEvidence — allowed types', () => {
  it('accepts JPG/PNG/WEBP/PDF with matching extension', () => {
    expect(validateEvidence({ buffer: JPG, fileName: 'a.jpg', claimedMime: 'image/jpeg', maxBytes: MAX })).toMatchObject({ ok: true });
    expect(validateEvidence({ buffer: PNG, fileName: 'a.png', claimedMime: 'image/png', maxBytes: MAX })).toMatchObject({ ok: true });
    expect(validateEvidence({ buffer: webp(), fileName: 'a.webp', claimedMime: 'image/webp', maxBytes: MAX })).toMatchObject({ ok: true });
    expect(validateEvidence({ buffer: PDF, fileName: 'a.pdf', claimedMime: 'application/pdf', maxBytes: MAX })).toMatchObject({ ok: true });
  });

  it('returns a stable sha256 + canonical ext + mime', () => {
    const r = validateEvidence({ buffer: PNG, fileName: 'photo.PNG', maxBytes: MAX });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mime).toBe('image/png');
      expect(r.value.ext).toBe('png');
      expect(r.value.sha256).toHaveLength(64);
    }
  });
});

describe('validateEvidence — rejections', () => {
  it('rejects oversize', () => {
    expect(validateEvidence({ buffer: JPG, fileName: 'a.jpg', maxBytes: 2 })).toEqual({ ok: false, code: 'EVIDENCE_TOO_LARGE' });
  });

  it('rejects an empty file', () => {
    expect(validateEvidence({ buffer: new Uint8Array(0), fileName: 'a.jpg', maxBytes: MAX })).toEqual({ ok: false, code: 'EVIDENCE_CONTENT_MISMATCH' });
  });

  it('rejects SVG / HTML / executables (unsupported magic bytes)', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const html = new TextEncoder().encode('<!doctype html><html></html>');
    const exe = bytes([0x4d, 0x5a]); // MZ
    expect(validateEvidence({ buffer: svg, fileName: 'x.svg', maxBytes: MAX })).toEqual({ ok: false, code: 'UNSUPPORTED_EVIDENCE_TYPE' });
    expect(validateEvidence({ buffer: html, fileName: 'x.html', maxBytes: MAX })).toEqual({ ok: false, code: 'UNSUPPORTED_EVIDENCE_TYPE' });
    expect(validateEvidence({ buffer: exe, fileName: 'x.exe', maxBytes: MAX })).toEqual({ ok: false, code: 'UNSUPPORTED_EVIDENCE_TYPE' });
  });

  it('rejects extension↔content mismatch', () => {
    // PNG bytes but a .pdf extension
    expect(validateEvidence({ buffer: PNG, fileName: 'a.pdf', maxBytes: MAX })).toEqual({ ok: false, code: 'EVIDENCE_CONTENT_MISMATCH' });
  });

  it('rejects a claimed allowed MIME that contradicts the bytes', () => {
    // bytes are not any allowed type, but client claims image/png
    const junk = bytes([0x00, 0x01, 0x02, 0x03]);
    expect(validateEvidence({ buffer: junk, fileName: 'a.png', claimedMime: 'image/png', maxBytes: MAX })).toEqual({ ok: false, code: 'EVIDENCE_CONTENT_MISMATCH' });
  });

  it('rejects a claimed non-allowed MIME even when bytes and extension look valid', () => {
    expect(validateEvidence({ buffer: JPG, fileName: 'a.jpg', claimedMime: 'application/octet-stream', maxBytes: MAX }))
      .toEqual({ ok: false, code: 'EVIDENCE_CONTENT_MISMATCH' });
  });
});

describe('sanitizeFileName / detectType', () => {
  it('strips paths and null bytes', () => {
    expect(sanitizeFileName('../../etc/pa\u0000ss.jpg')).toBe('pass.jpg');
    expect(sanitizeFileName('C:\\Users\\x\\evil.pdf')).toBe('evil.pdf');
    expect(sanitizeFileName('')).toBe('evidence');
  });
  it('detects by magic bytes only', () => {
    expect(detectType(JPG)?.mime).toBe('image/jpeg');
    expect(detectType(bytes([0x00]))).toBeNull();
  });
});
