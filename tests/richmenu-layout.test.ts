import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { validateRichMenuAreas, readImageSize, type RichMenuArea } from '@/lib/richmenu/env';

interface RichMenuConfig {
  size: { width: number; height: number };
  areas: RichMenuArea[];
}
const cfg = JSON.parse(
  readFileSync(path.join(process.cwd(), 'config/richmenu.json'), 'utf8'),
) as RichMenuConfig;

describe('config/richmenu.json layout', () => {
  it('is 2500x1686', () => {
    expect(cfg.size).toEqual({ width: 2500, height: 1686 });
  });

  it('has no overlaps and stays within bounds', () => {
    expect(validateRichMenuAreas(cfg.size, cfg.areas)).toEqual([]);
  });

  it('top row is a full-width แจ้งลา button', () => {
    const leave = cfg.areas.find((a) => a.action.label === 'แจ้งลา')!;
    expect(leave.bounds).toEqual({ x: 0, y: 0, width: 2500, height: 843 });
    expect(leave.action.uri).toBe('{{LIFF_LEAVE}}');
  });

  it('the three bottom buttons cover x=0..2500 exactly with no gap/overlap', () => {
    const bottom = cfg.areas
      .filter((a) => a.bounds.y === 843)
      .sort((a, b) => a.bounds.x - b.bounds.x);
    expect(bottom.map((a) => a.action.label)).toEqual(['แจ้งเข้างาน', 'แจ้งออกงาน', 'เช็กสิทธิ์']);
    // contiguous coverage
    expect(bottom[0].bounds.x).toBe(0);
    for (let i = 1; i < bottom.length; i++) {
      expect(bottom[i].bounds.x).toBe(bottom[i - 1].bounds.x + bottom[i - 1].bounds.width);
    }
    const last = bottom[bottom.length - 1];
    expect(last.bounds.x + last.bounds.width).toBe(2500);
    for (const a of bottom) expect(a.bounds.height).toBe(843);
  });

  it('maps bottom buttons to the correct LIFF placeholders', () => {
    const uri = (label: string) => cfg.areas.find((a) => a.action.label === label)!.action.uri;
    expect(uri('แจ้งเข้างาน')).toBe('{{LIFF_CHECKIN}}');
    expect(uri('แจ้งออกงาน')).toBe('{{LIFF_CHECKOUT}}');
    expect(uri('เช็กสิทธิ์')).toBe('{{LIFF_BALANCE}}');
  });
});

describe('validateRichMenuAreas', () => {
  const size = { width: 2500, height: 1686 };
  it('flags overlapping areas', () => {
    const areas: RichMenuArea[] = [
      { bounds: { x: 0, y: 0, width: 1300, height: 843 }, action: { label: 'A' } },
      { bounds: { x: 1200, y: 0, width: 1300, height: 843 }, action: { label: 'B' } },
    ];
    expect(validateRichMenuAreas(size, areas).join()).toContain('overlap');
  });
  it('flags areas exceeding the menu size', () => {
    const areas: RichMenuArea[] = [{ bounds: { x: 0, y: 0, width: 3000, height: 843 }, action: { label: 'X' } }];
    expect(validateRichMenuAreas(size, areas).join()).toContain('exceeds width');
  });
});

describe('readImageSize', () => {
  it('reads PNG dimensions', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const dv = new DataView(png.buffer);
    dv.setUint32(16, 2500);
    dv.setUint32(20, 1686);
    expect(readImageSize(png)).toEqual({ width: 2500, height: 1686 });
  });
  it('reads JPEG dimensions (SOF0)', () => {
    // FFD8 (SOI) then FFC0 (SOF0) len=17, precision, height(2), width(2)
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x06, 0x96, 0x09, 0xc4]);
    expect(readImageSize(jpg)).toEqual({ width: 2500, height: 1686 });
  });
  it('returns null for unknown', () => {
    expect(readImageSize(new Uint8Array([0x00, 0x01]))).toBeNull();
  });
});
