import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { PixelStats } from './image';

export interface SampledImageStats extends PixelStats {
  width: number;
  height: number;
  pixelFormat: string;
}

/**
 * Sample an image's pixels via the Windows System.Drawing helper and return
 * white/black/luminance stats. Returns null when sampling isn't available
 * (non-Windows / PowerShell error) so callers can skip the blank check with a
 * warning rather than hard-fail. Never calls the LINE API.
 */
export function sampleImageStats(imagePath: string): SampledImageStats | null {
  try {
    const script = path.join(process.cwd(), 'scripts', 'richmenu-image-stats.ps1');
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, imagePath],
      { encoding: 'utf8', timeout: 30000 },
    );
    if (r.status !== 0 || !r.stdout) return null;
    const line = r.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    if (!line) return null;
    const j = JSON.parse(line) as Record<string, unknown>;
    return {
      width: Number(j.width),
      height: Number(j.height),
      pixelFormat: String(j.pixelFormat),
      count: Number(j.sampled),
      whitePct: Number(j.whitePct),
      blackPct: Number(j.blackPct),
      avgLuminance: Number(j.avgLuminance),
    };
  } catch {
    return null;
  }
}
