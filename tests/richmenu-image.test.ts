import { describe, it, expect } from 'vitest';
import { detectImageMime, analyzeImage, contentTypeForUpload, imageWarnings, jpegQualityLadder, computePixelStats, isLikelyBlank } from '@/lib/richmenu/image';

// ---- byte builders (no real image libs / no LINE) ----
function jpeg(components: number, w = 2500, h = 1686, adobe?: number): Uint8Array {
  const parts: number[] = [0xff, 0xd8]; // SOI
  parts.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0); // APP0 JFIF (len 16)
  if (adobe !== undefined) {
    // APP14 "Adobe" segment, length 14, transform byte last.
    parts.push(0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0, 0, 0, 0, 0, 0, adobe);
  }
  // SOF0: len=8+3*components, precision 8, height, width, components
  const sofLen = 8 + 3 * components;
  parts.push(0xff, 0xc0, (sofLen >> 8) & 0xff, sofLen & 0xff, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, components);
  for (let i = 0; i < components; i++) parts.push(i + 1, 0x11, 0);
  return new Uint8Array(parts);
}
function png(colorType: number, w = 2500, h = 1686): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  b.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR len 13
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  b[24] = 8; // bit depth
  b[25] = colorType;
  return b;
}

describe('detectImageMime', () => {
  it('detects JPEG and PNG by magic bytes', () => {
    expect(detectImageMime(jpeg(3))).toBe('image/jpeg');
    expect(detectImageMime(png(2))).toBe('image/png');
    expect(detectImageMime(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull(); // "<svg"
  });
});

describe('analyzeImage — JPEG', () => {
  it('reports RGB (3 components) as not CMYK, with dimensions', () => {
    const a = analyzeImage(jpeg(3, 2500, 1686));
    expect(a.mime).toBe('image/jpeg');
    expect(a.width).toBe(2500);
    expect(a.height).toBe(1686);
    expect(a.jpeg?.components).toBe(3);
    expect(a.jpeg?.isCmyk).toBe(false);
  });
  it('flags CMYK (4 components)', () => {
    const a = analyzeImage(jpeg(4));
    expect(a.jpeg?.isCmyk).toBe(true);
    expect(imageWarnings(a).join()).toContain('CMYK');
  });
});

describe('analyzeImage — PNG', () => {
  it('flags transparency (RGBA colorType 6)', () => {
    const a = analyzeImage(png(6));
    expect(a.png?.hasAlpha).toBe(true);
    expect(imageWarnings(a).join()).toContain('transparency');
  });
  it('opaque RGB (colorType 2) has no alpha', () => {
    expect(analyzeImage(png(2)).png?.hasAlpha).toBe(false);
  });
});

describe('contentTypeForUpload', () => {
  it('picks image/jpeg for a .jpg with JPEG magic bytes', () => {
    expect(contentTypeForUpload('config/richmenu.jpg', jpeg(3))).toBe('image/jpeg');
    expect(contentTypeForUpload('config/richmenu.jpeg', jpeg(3))).toBe('image/jpeg');
  });
  it('picks image/png for a .png with PNG magic bytes', () => {
    expect(contentTypeForUpload('menu.png', png(2))).toBe('image/png');
  });
  it('throws on extension/content mismatch (never hardcodes)', () => {
    expect(() => contentTypeForUpload('menu.png', jpeg(3))).toThrow();
  });
  it('throws on an unsupported type', () => {
    expect(() => contentTypeForUpload('x.gif', new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toThrow();
  });
});

describe('jpegQualityLadder (image-convert auto quality reduction)', () => {
  it('steps 88 -> 55 by 5 and ends exactly at 55', () => {
    expect(jpegQualityLadder(88, 55, 5)).toEqual([88, 83, 78, 73, 68, 63, 58, 55]);
  });
  it('never goes below the minimum', () => {
    for (const q of jpegQualityLadder(88, 55, 5)) expect(q).toBeGreaterThanOrEqual(55);
  });
  it('always includes the minimum even when not a multiple of the step', () => {
    const ladder = jpegQualityLadder(90, 55, 10); // 90,80,70,60 then +55
    expect(ladder[ladder.length - 1]).toBe(55);
  });
});

describe('computePixelStats / isLikelyBlank (Bug 4 — blank white image)', () => {
  function fill(n: number, rgb: [number, number, number]): Uint8Array {
    const a = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      a[i * 4] = rgb[0];
      a[i * 4 + 1] = rgb[1];
      a[i * 4 + 2] = rgb[2];
      a[i * 4 + 3] = 255;
    }
    return a;
  }

  it('all-white -> 100% white, flagged blank', () => {
    const s = computePixelStats(fill(100, [255, 255, 255]));
    expect(s.whitePct).toBe(100);
    expect(isLikelyBlank(s)).toBe(true);
  });

  it('all-black -> 100% black, luminance 0, NOT blank', () => {
    const s = computePixelStats(fill(100, [0, 0, 0]));
    expect(s.blackPct).toBe(100);
    expect(s.avgLuminance).toBe(0);
    expect(isLikelyBlank(s)).toBe(false);
  });

  it('real-ish artwork (mixed) is not flagged blank', () => {
    const half = fill(50, [255, 255, 255]);
    const other = fill(50, [30, 120, 200]);
    const merged = new Uint8Array(half.length + other.length);
    merged.set(half, 0);
    merged.set(other, half.length);
    const s = computePixelStats(merged);
    expect(s.whitePct).toBe(50);
    expect(isLikelyBlank(s)).toBe(false);
  });

  it('99% white crosses the default 98% blank threshold', () => {
    const white = fill(99, [255, 255, 255]);
    const one = fill(1, [0, 0, 0]);
    const merged = new Uint8Array(white.length + one.length);
    merged.set(white, 0);
    merged.set(one, white.length);
    expect(isLikelyBlank(computePixelStats(merged))).toBe(true);
  });
});

describe('imageWarnings — dimension mismatch', () => {
  it('warns when the size differs from the expected menu size', () => {
    const a = analyzeImage(jpeg(3, 1000, 1000));
    expect(imageWarnings(a, { width: 2500, height: 1686 }).join()).toContain('ไม่ตรง config');
  });
});
