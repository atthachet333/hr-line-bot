/**
 * Inspect a Rich Menu image locally — NO LINE API.
 *
 * Usage:
 *   npm run richmenu:image-check
 *   npm run richmenu:image-check -- path/to/image.jpg
 *
 * Reports dimensions, MIME, magic bytes, RGB/CMYK, transparency, size, sha256,
 * and warnings that predict a black/broken menu in LINE.
 */
import { loadEnvConfig } from '@next/env';
import { readFileSync, existsSync } from 'fs';
import { analyzeImage, imageWarnings, isLikelyBlank } from '@/lib/richmenu/image';
import { sampleImageStats } from '@/lib/richmenu/image-stats';

loadEnvConfig(process.cwd());

function main() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const imagePath = arg || process.env.RICH_MENU_IMAGE_PATH || 'config/richmenu.jpg';
  if (!existsSync(imagePath)) {
    console.error(`❌ Image not found: ${imagePath}`);
    process.exit(1);
  }
  const buf = readFileSync(imagePath);
  const a = analyzeImage(buf);

  console.log('\nRich Menu image check (local, no LINE API)');
  console.log('='.repeat(60));
  console.log(`  path        : ${imagePath}`);
  console.log(`  detectedMime: ${a.mime ?? '(unknown)'}`);
  console.log(`  magic bytes : ${a.magicHex}`);
  console.log(`  dimensions  : ${a.width ?? '?'} x ${a.height ?? '?'}`);
  console.log(`  fileSize    : ${a.sizeBytes} bytes (${(a.sizeBytes / 1024).toFixed(1)} KB)`);
  console.log(`  sha256      : ${a.sha256}`);
  if (a.jpeg) {
    console.log(`  jpeg        : components=${a.jpeg.components} (${a.jpeg.isCmyk ? 'CMYK ⚠️' : 'RGB'}), ` +
      `precision=${a.jpeg.precision}, ${a.jpeg.progressive ? 'progressive' : 'baseline'}, ` +
      `adobeTransform=${a.jpeg.adobeTransform ?? 'none'}`);
  }
  if (a.png) {
    console.log(`  png         : colorType=${a.png.colorType}, bitDepth=${a.png.bitDepth}, hasAlpha=${a.png.hasAlpha}`);
  }

  // Pixel-level stats (Windows System.Drawing) — detects blank/placeholder art.
  const stats = sampleImageStats(imagePath);
  const warnings = imageWarnings(a, { width: 2500, height: 1686 });
  if (stats) {
    console.log(`  pixelFormat : ${stats.pixelFormat}`);
    console.log(`  luminance   : avg ${stats.avgLuminance}/255`);
    console.log(`  white/black : ${stats.whitePct}% white, ${stats.blackPct}% black (sampled ${stats.count})`);
    if (isLikelyBlank(stats)) warnings.push(`ภาพเกือบทั้งหมดเป็นสีขาว (${stats.whitePct}%) — เป็น placeholder/blank ห้ามอัปโหลด`);
  } else {
    console.log('  pixel stats : (skipped — pixel sampler unavailable on this OS)');
  }

  if (warnings.length) {
    console.log('\n⚠️  Warnings:');
    for (const w of warnings) console.log(`   - ${w}`);
    console.log('\n   Fix black/format issues with:  npm run richmenu:image-convert -- <source> config/richmenu.jpg');
  } else {
    console.log('\n✅ Looks good (RGB, correct size, no transparency, reasonable file size).');
  }
}

main();
