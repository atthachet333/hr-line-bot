import { PayloadTooLargeError, UnsupportedMediaTypeError, ValidationError } from '@/lib/errors';

export const DEFAULT_MAX_BODY_BYTES = 32 * 1024; // 32 KB

/**
 * Read and parse a JSON request body with content-type and size guards.
 * Throws typed AppErrors so the caller's catch produces a uniform envelope.
 */
export async function readJsonBody<T = unknown>(
  req: Request,
  opts: { maxBytes?: number } = {},
): Promise<T> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BODY_BYTES;

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new UnsupportedMediaTypeError('รองรับเฉพาะข้อมูลแบบ JSON');
  }

  // Enforce Content-Length when provided.
  const declaredLength = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PayloadTooLargeError('ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป');
  }

  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new PayloadTooLargeError('ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป');
  }
  if (raw.trim() === '') {
    throw new ValidationError('ไม่พบข้อมูลในคำขอ');
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ValidationError('รูปแบบข้อมูล JSON ไม่ถูกต้อง');
  }
}

/** Read a raw body with a size cap (used by the webhook, which needs the raw text). */
export async function readRawBody(req: Request, maxBytes = 64 * 1024): Promise<string> {
  const declaredLength = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PayloadTooLargeError('payload too large');
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new PayloadTooLargeError('payload too large');
  }
  return raw;
}
