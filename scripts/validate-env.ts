/**
 * Validate environment variables.
 *
 * Usage:
 *   npm run validate:env            # dev mode: missing secrets are warnings
 *   npm run validate:env -- --prod  # strict: missing secrets are errors
 *
 * Loads .env.local / .env if present (best-effort) so it can run locally.
 */
import { existsSync, readFileSync } from 'fs';
import { validateEnvironment } from '@/lib/env';

function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  const content = readFileSync(file, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv('.env.local');
loadDotEnv('.env');

const production = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const report = validateEnvironment({ production, requireSecrets: production });

console.log(`\nEnvironment validation (${production ? 'production/strict' : 'dev'} mode)`);
console.log('='.repeat(50));
if (report.warnings.length) {
  console.log('\nWarnings:');
  for (const w of report.warnings) console.log(`  ⚠️  ${w}`);
}
if (report.errors.length) {
  console.log('\nErrors:');
  for (const e of report.errors) console.log(`  ❌ ${e}`);
}
if (report.ok) {
  console.log('\n✅ Environment OK');
  process.exit(0);
} else {
  console.log(`\n❌ Environment validation failed (${report.errors.length} error(s))`);
  process.exit(1);
}
