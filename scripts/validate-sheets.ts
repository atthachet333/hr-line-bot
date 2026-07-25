/**
 * Validate the Google Sheets schema (tabs + headers).
 *
 * Usage: npm run validate:sheets
 *
 * Requires GOOGLE_* credentials. When credentials are absent (e.g. CI without
 * secrets) it skips gracefully with exit 0 so it does not block verification.
 */
import { existsSync, readFileSync } from 'fs';

function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv('.env.local');
loadDotEnv('.env');

async function main() {
  if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.log('⏭️  validate:sheets skipped — GOOGLE credentials not configured');
    process.exit(0);
  }

  const { validateSheetsSchema } = await import('@/lib/sheets/schema-validator');
  const report = await validateSheetsSchema();

  console.log('\nGoogle Sheets schema validation');
  console.log('='.repeat(50));
  for (const c of report.checks) {
    const icon = c.status === 'ok' ? '✅' : '❌';
    let line = `  ${icon} ${c.sheet}: ${c.status}`;
    if (c.missingColumns) line += ` (missing: ${c.missingColumns.join(', ')})`;
    if (c.duplicateColumns) line += ` (duplicate: ${c.duplicateColumns.join(', ')})`;
    if (c.message) line += ` — ${c.message}`;
    console.log(line);
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ validate:sheets error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
