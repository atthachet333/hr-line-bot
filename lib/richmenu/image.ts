import { createHash } from 'crypto';
import { readImageSize } from './env';

/**
 * Pure image analysis for the Rich Menu upload pipeline (no I/O, no deps). Used
 * to pick the correct Content-Type from magic bytes and to detect the formats
 * that render BLACK in LINE (CMYK JPEG, or PNG transparency that gets flattened).
 */

export type ImageMime = 'image/jpeg' | 'image/png';

/** Detect the image MIME from magic bytes (null when not JPEG/PNG). */
export function detectImageMime(buf: Uint8Array): ImageMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

export interface JpegInfo {
  components: number;
  precision: number;
  progressive: boolean;
  /** Adobe APP14 transform byte (0=CMYK/none, 2=YCCK) when present. */
  adobeTransform: number | null;
  /** True when the JPEG is CMYK/YCCK (4 components) — renders black in LINE. */
  isCmyk: boolean;
}

export interface PngInfo {
  colorType: number;
  bitDepth: number;
  /** True for RGBA / grayscale+alpha / palette with tRNS — needs flatten. */
  hasAlpha: boolean;
}

export interface ImageAnalysis {
  mime: ImageMime | null;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  sha256: string;
  magicHex: string;
  jpeg?: JpegInfo;
  png?: PngInfo;
}

function analyzeJpeg(buf: Uint8Array): JpegInfo {
  let components = 0;
  let precision = 8;
  let progressive = false;
  let adobeTransform: number | null = null;
  let o = 2;
  while (o + 4 < buf.length) {
    if (buf[o] !== 0xff) { o++; continue; }
    const marker = buf[o + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan
    const len = (buf[o + 2] << 8) | buf[o + 3];
    if (marker === 0xee && len >= 14) {
      // APP14 "Adobe" — transform is the last byte of the segment.
      adobeTransform = buf[o + 2 + len - 1] ?? null;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      progressive = marker === 0xc2;
      precision = buf[o + 4];
      components = buf[o + 9];
      break;
    }
    o += 2 + len;
  }
  return { components, precision, progressive, adobeTransform, isCmyk: components === 4 };
}

function analyzePng(buf: Uint8Array): PngInfo {
  // IHDR starts at byte 16 (after 8-sig + 4 len + 4 "IHDR"); bit depth @24, color type @25.
  const bitDepth = buf[24] ?? 0;
  const colorType = buf[25] ?? 0;
  let hasAlpha = colorType === 4 || colorType === 6; // grayscale+alpha / RGBA
  // A palette PNG (type 3) can carry transparency via a tRNS chunk.
  if (colorType === 3) {
    for (let i = 8; i + 8 < buf.length; ) {
      const len = (buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3];
      const type = String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7]);
      if (type === 'tRNS') { hasAlpha = true; break; }
      if (type === 'IDAT' || type === 'IEND') break;
      i += 12 + len;
    }
  }
  return { colorType, bitDepth, hasAlpha };
}

export function analyzeImage(buf: Uint8Array): ImageAnalysis {
  const mime = detectImageMime(buf);
  const dims = readImageSize(buf);
  const analysis: ImageAnalysis = {
    mime,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    sizeBytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    magicHex: Array.from(buf.slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join(' '),
  };
  if (mime === 'image/jpeg') analysis.jpeg = analyzeJpeg(buf);
  if (mime === 'image/png') analysis.png = analyzePng(buf);
  return analysis;
}

/**
 * Choose the upload Content-Type from magic bytes, requiring the file extension
 * to agree. Throws on unknown types or extension/content mismatch — the caller
 * must never guess (a wrong Content-Type is a common black-image cause).
 */
export function contentTypeForUpload(filePath: string, buf: Uint8Array): ImageMime {
  const mime = detectImageMime(buf);
  if (!mime) throw new Error('unsupported image (only JPEG/PNG); magic bytes did not match');
  const ext = (filePath.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? '').toLowerCase();
  const okExt = mime === 'image/jpeg' ? ['jpg', 'jpeg'] : ['png'];
  if (ext && !okExt.includes(ext)) {
    throw new Error(`extension .${ext} does not match detected ${mime}`);
  }
  return mime;
}

/**
 * The JPEG quality ladder used by the image-convert step: from `start` down to
 * `min` in `step` decrements, always ending exactly at `min`. Mirrors the
 * PowerShell converter so the sequence is unit-testable without running GDI.
 */
export function jpegQualityLadder(start = 88, min = 55, step = 5): number[] {
  const out: number[] = [];
  for (let q = start; q >= min; q -= step) out.push(q);
  if (out[out.length - 1] !== min) out.push(min);
  return out;
}

// ---- pixel statistics (blank/black detection) ----

export interface PixelStats {
  count: number;
  whitePct: number; // % of near-white pixels (r,g,b >= 250)
  blackPct: number; // % of near-black pixels (luminance < 12)
  avgLuminance: number; // 0..255
}

/** Compute white/black/luminance stats from RGB(A) samples (4 bytes per pixel). */
export function computePixelStats(rgba: ArrayLike<number>): PixelStats {
  const px = Math.floor(rgba.length / 4);
  if (px === 0) return { count: 0, whitePct: 0, blackPct: 0, avgLuminance: 0 };
  let white = 0;
  let black = 0;
  let lumSum = 0;
  for (let i = 0; i < px; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    lumSum += lum;
    if (r >= 250 && g >= 250 && b >= 250) white++;
    if (lum < 12) black++;
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    count: px,
    whitePct: round1((white / px) * 100),
    blackPct: round1((black / px) * 100),
    avgLuminance: round1(lumSum / px),
  };
}

/** A menu image is "blank" when almost every pixel is white (placeholder). */
export function isLikelyBlank(stats: PixelStats, whiteThresholdPct = 98): boolean {
  return stats.count > 0 && stats.whitePct >= whiteThresholdPct;
}

/** Human-readable warnings that predict a black/broken menu in LINE. */
export function imageWarnings(a: ImageAnalysis, expected?: { width: number; height: number }): string[] {
  const w: string[] = [];
  if (!a.mime) w.push('ไม่รู้จักชนิดไฟล์ (รองรับเฉพาะ JPEG/PNG)');
  if (a.jpeg?.isCmyk) w.push('JPEG เป็น CMYK (LINE จะแสดงเป็นสีดำ) — ต้องแปลงเป็น RGB/sRGB');
  if (a.jpeg && a.jpeg.progressive) w.push('JPEG เป็น progressive — แนะนำ baseline');
  if (a.png?.hasAlpha) w.push('PNG มี transparency — ต้อง flatten ลงพื้นหลังสีขาว (กัน flatten เป็นดำ)');
  if (expected && a.width && a.height && (a.width !== expected.width || a.height !== expected.height)) {
    w.push(`ขนาด ${a.width}x${a.height} ไม่ตรง config ${expected.width}x${expected.height}`);
  }
  if (a.sizeBytes > 1024 * 1024) w.push(`ไฟล์ใหญ่ ${(a.sizeBytes / (1024 * 1024)).toFixed(2)} MB (แนะนำ < 1 MB)`);
  return w;
}
