/**
 * Create/replace the LINE Rich Menu of the Employee bot (น้องถ้วยฟู) from
 * config/richmenu.json.
 *
 * Usage:
 *   npm run richmenu:update                 # dry-run: prints the resolved menu + plan
 *   npm run richmenu:update -- --confirm    # create + upload + set default (safe, rollback)
 *
 * Loads env via @next/env FIRST. Uses EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN (never
 * the manager token). Never prints the token.
 */
import { loadEnvConfig } from '@next/env';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import {
  richMenuLiffByPage,
  richMenuDiagnostics,
  liffDeepLink,
  validateRichMenuAreas,
  readImageSize,
  type RichMenuLiff,
  type RichMenuArea,
} from '@/lib/richmenu/env';
import { analyzeImage, contentTypeForUpload, isLikelyBlank } from '@/lib/richmenu/image';
import { sampleImageStats } from '@/lib/richmenu/image-stats';

loadEnvConfig(process.cwd());

const API = 'https://api.line.me/v2/bot';
const API_DATA = 'https://api-data.line.me/v2/bot';

const PLACEHOLDER: Record<string, keyof RichMenuLiff> = {
  '{{LIFF_CHECKIN}}': 'checkin',
  '{{LIFF_CHECKOUT}}': 'checkout',
  '{{LIFF_LEAVE}}': 'leave',
  '{{LIFF_BALANCE}}': 'balance',
};

function resolvePlaceholders(obj: unknown, liff: RichMenuLiff): unknown {
  if (typeof obj === 'string') {
    const page = PLACEHOLDER[obj];
    if (page) {
      const id = liff[page];
      if (!id) throw new Error(`Missing LIFF id for "${page}" (NEXT_PUBLIC_LIFF_ID_* not set)`);
      return liffDeepLink(id);
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map((v) => resolvePlaceholders(v, liff));
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = resolvePlaceholders(v, liff);
    return out;
  }
  return obj;
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const liff = richMenuLiffByPage(process.env);

  console.log('\nRich Menu update');
  console.log('='.repeat(60));
  console.log('Diagnostics:', JSON.stringify(richMenuDiagnostics(process.env)));

  const token = process.env.EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN || '';
  if (!token) {
    console.error('❌ EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN is not set.');
    process.exit(1);
  }

  const cfgRaw = JSON.parse(readFileSync('config/richmenu.json', 'utf8')) as Record<string, unknown>;
  const imagePath = process.env.RICH_MENU_IMAGE_PATH || (cfgRaw.image as string) || '';
  delete cfgRaw._comment;
  delete cfgRaw.image;
  const menu = resolvePlaceholders(cfgRaw, liff) as {
    size: { width: number; height: number };
    areas: RichMenuArea[];
  };

  // Geometry validation (overlap / within-bounds) — always, in dry-run too.
  const areaErrors = validateRichMenuAreas(menu.size, menu.areas);
  console.log(`Menu size: ${menu.size.width}x${menu.size.height}`);
  console.log('Resolved areas (ordered):');
  menu.areas.forEach((a, i) => {
    const b = a.bounds;
    console.log(`  [${i}] "${a.action.label}" bounds=(${b.x},${b.y},${b.width},${b.height}) -> ${a.action.uri}`);
  });
  if (areaErrors.length) {
    console.error('❌ Invalid rich menu geometry:');
    for (const e of areaErrors) console.error(`   - ${e}`);
    process.exit(1);
  }

  // Image dimension check (must match config size) when the image is present.
  if (imagePath && existsSync(imagePath)) {
    const dims = readImageSize(readFileSync(imagePath));
    if (dims && (dims.width !== menu.size.width || dims.height !== menu.size.height)) {
      console.error(`❌ Image ${dims.width}x${dims.height} does not match config size ${menu.size.width}x${menu.size.height}`);
      process.exit(1);
    }
    console.log(`Image dimensions: ${dims ? `${dims.width}x${dims.height} ✓` : '(unreadable — skipped)'}`);
  }

  if (!confirm) {
    console.log('\n⚠️  DRY-RUN. No LINE API calls made.');
    console.log('    Plan: create -> upload image -> set default -> verify -> delete old.');
    console.log('    Re-run with --confirm to apply. Image:', imagePath || '(none set)');
    process.exit(0);
  }

  if (!imagePath || !existsSync(imagePath)) {
    console.error(`❌ Rich menu image not found: ${imagePath || '(unset)'} — set RICH_MENU_IMAGE_PATH or config.image.`);
    process.exit(1);
  }

  // Content-Type from MAGIC BYTES (extension must agree) — never hardcoded.
  const imageBuf = readFileSync(imagePath);
  let contentType: 'image/jpeg' | 'image/png';
  try {
    contentType = contentTypeForUpload(imagePath, imageBuf);
  } catch (e) {
    console.error(`❌ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  const analysis = analyzeImage(imageBuf);
  // Pre-upload diagnostic (no token).
  console.log('\nUpload diagnostic:');
  console.log(`  imagePath    : ${imagePath}`);
  console.log(`  detectedMime : ${analysis.mime}`);
  console.log(`  contentType  : ${contentType}`);
  console.log(`  fileSizeBytes: ${analysis.sizeBytes}`);
  console.log(`  dimensions   : ${analysis.width}x${analysis.height}`);
  console.log(`  magic bytes  : ${analysis.magicHex}`);
  console.log(`  sha256       : ${analysis.sha256}`);
  if (analysis.jpeg) console.log(`  colorMode    : ${analysis.jpeg.isCmyk ? 'CMYK' : 'RGB'} (components=${analysis.jpeg.components})`);
  if (analysis.png) console.log(`  pngAlpha     : ${analysis.png.hasAlpha}`);
  // Reject the formats that render black in LINE.
  if (analysis.jpeg?.isCmyk) {
    console.error('❌ CMYK JPEG will render BLACK in LINE. Convert first: npm run richmenu:image-convert -- <src> ' + imagePath);
    process.exit(1);
  }
  // Reject a blank/placeholder (near-all-white) image before touching LINE.
  const srcStats = sampleImageStats(imagePath);
  if (srcStats) {
    console.log(`  pixels       : ${srcStats.whitePct}% white, ${srcStats.blackPct}% black, luminance ${srcStats.avgLuminance}`);
    if (isLikelyBlank(srcStats)) {
      console.error(`❌ Image looks BLANK/placeholder (${srcStats.whitePct}% white). Provide real artwork before uploading.`);
      process.exit(1);
    }
  } else {
    console.log('  pixels       : (blank check skipped — pixel sampler unavailable)');
  }
  const localSha = createHash('sha256').update(imageBuf).digest('hex');

  const auth = { Authorization: `Bearer ${token}` };

  let oldDefault = '';
  try {
    const res = await fetch(`${API}/user/all/richmenu`, { headers: auth });
    if (res.ok) oldDefault = ((await res.json()) as { richMenuId: string }).richMenuId;
  } catch { /* no default */ }
  console.log('\nBacked up current default:', oldDefault || '(none)');

  let newId = '';
  try {
    const res = await fetch(`${API}/richmenu`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(menu),
    });
    if (!res.ok) throw new Error(`create HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    newId = ((await res.json()) as { richMenuId: string }).richMenuId;
    console.log('Created new rich menu:', newId);

    const imgRes = await fetch(`${API_DATA}/richmenu/${newId}/content`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': contentType },
      body: imageBuf, // raw Buffer — no base64, no multipart, no JSON.stringify
    });
    if (!imgRes.ok) throw new Error(`image upload HTTP ${imgRes.status}: ${(await imgRes.text()).slice(0, 200)}`);
    console.log('Uploaded image.');

    // Download the content back from LINE and VERIFY before switching default.
    const back = await fetch(`${API_DATA}/richmenu/${newId}/content`, { headers: auth });
    if (!back.ok) throw new Error(`download-back HTTP ${back.status}`);
    const dl = Buffer.from(await back.arrayBuffer());
    const dlSha = createHash('sha256').update(dl).digest('hex');
    writeFileSync('config/richmenu-downloaded.jpg', dl);
    const dlAnalysis = analyzeImage(dl);
    const dlStats = sampleImageStats('config/richmenu-downloaded.jpg');
    console.log('  download-back:', JSON.stringify({
      status: back.status,
      contentType: back.headers.get('content-type'),
      sizeBytes: dl.length,
      dimensions: `${dlAnalysis.width}x${dlAnalysis.height}`,
      whitePct: dlStats?.whitePct ?? null,
      shaMatchesLocal: dlSha === localSha,
    }));
    // Verify the round-tripped image: correct dimensions and NOT blank/white.
    if (dlAnalysis.width !== menu.size.width || dlAnalysis.height !== menu.size.height) {
      throw new Error(`downloaded image ${dlAnalysis.width}x${dlAnalysis.height} != ${menu.size.width}x${menu.size.height}`);
    }
    if (dlStats && isLikelyBlank(dlStats)) {
      throw new Error(`downloaded image is blank/white (${dlStats.whitePct}%) — not switching the menu`);
    }

    // Only NOW switch the default (old menu is still intact if anything failed).
    const setRes = await fetch(`${API}/user/all/richmenu/${newId}`, { method: 'POST', headers: auth });
    if (!setRes.ok) throw new Error(`set default HTTP ${setRes.status}: ${(await setRes.text()).slice(0, 200)}`);

    const verify = await fetch(`${API}/user/all/richmenu`, { headers: auth });
    const verifiedId = verify.ok ? ((await verify.json()) as { richMenuId: string }).richMenuId : '';
    if (verifiedId !== newId) throw new Error(`verify failed: default is ${verifiedId}, expected ${newId}`);
    console.log('Set as default and verified.');
  } catch (err) {
    console.error('❌ Update failed:', err instanceof Error ? err.message : err);
    if (oldDefault) {
      await fetch(`${API}/user/all/richmenu/${oldDefault}`, { method: 'POST', headers: auth }).catch(() => {});
      console.error('↩️  Restored previous default:', oldDefault);
    }
    if (newId) {
      await fetch(`${API}/richmenu/${newId}`, { method: 'DELETE', headers: auth }).catch(() => {});
      console.error('🗑️  Deleted half-created menu:', newId);
    }
    process.exit(1);
  }

  if (oldDefault && oldDefault !== newId) {
    const del = await fetch(`${API}/richmenu/${oldDefault}`, { method: 'DELETE', headers: auth });
    console.log(del.ok ? `Deleted old menu ${oldDefault}` : `Warning: could not delete old menu ${oldDefault}`);
  }
  console.log('\n✅ Rich menu updated. New default:', newId);
}

main().catch((e) => {
  console.error('❌ update error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
