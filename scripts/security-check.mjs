#!/usr/bin/env node
/**
 * Lightweight repository secret scanner + dependency audit summary.
 * Fails (exit 1) when likely secrets are found in tracked source files.
 * Does NOT modify anything. Run: npm run security:check
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  { name: 'Google Apps Script URL', re: /script\.google\.com\/macros\/s\/AKfyc[\w-]+/ },
  { name: 'PEM private key', re: /-----BEGIN (?:RSA )?PRIVATE KEY-----/ },
  { name: 'Hardcoded Bearer token', re: /Bearer\s+[A-Za-z0-9]{25,}/ },
  { name: 'LINE long-lived token literal', re: /[A-Za-z0-9+/]{80,}=*\s*['"]?\s*;?\s*\/\/\s*channel/i },
  { name: 'NEXT_PUBLIC secret-ish', re: /NEXT_PUBLIC_[A-Z_]*(SECRET|TOKEN|PRIVATE|KEY)/ },
];

// Files tracked by git, excluding lockfiles / docs examples that legitimately
// contain placeholder names.
let files = [];
try {
  files = execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|js|mjs|cjs|json)$/.test(f))
    .filter((f) => !f.endsWith('package-lock.json'))
    .filter((f) => !f.startsWith('scripts/security-check'));
} catch {
  console.error('Not a git repository or git unavailable; scanning src/lib/app dirs.');
}

const findings = [];
for (const file of files) {
  let content = '';
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const { name, re } of PATTERNS) {
    const m = content.match(re);
    if (m) findings.push({ file, name, snippet: m[0].slice(0, 40) });
  }
}

console.log('\nSecurity scan');
console.log('='.repeat(50));
if (findings.length === 0) {
  console.log('✅ No hardcoded secrets / Apps Script URLs found in tracked source.');
} else {
  console.log('❌ Potential secrets found:');
  for (const f of findings) console.log(`  - ${f.file}: ${f.name} (${f.snippet}...)`);
}

// Ensure .env is not tracked.
try {
  const tracked = execSync('git ls-files', { encoding: 'utf8' });
  const envTracked = tracked.split('\n').filter((f) => /^\.env($|\.local|\.staging$|\.production$)/.test(f));
  if (envTracked.length) {
    console.log(`❌ .env file is tracked by git: ${envTracked.join(', ')}`);
    findings.push({ file: envTracked.join(','), name: '.env tracked' });
  } else {
    console.log('✅ No real .env files tracked by git.');
  }
} catch {
  /* ignore */
}

// Dependency audit summary (non-fatal — reported truthfully).
console.log('\nDependency audit (npm audit --omit=dev):');
try {
  const auditJson = execSync('npm audit --omit=dev --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const audit = JSON.parse(auditJson);
  const vulns = audit.metadata?.vulnerabilities ?? {};
  console.log(`  info:${vulns.info ?? 0} low:${vulns.low ?? 0} moderate:${vulns.moderate ?? 0} high:${vulns.high ?? 0} critical:${vulns.critical ?? 0}`);
} catch (e) {
  // npm audit exits non-zero when vulnerabilities exist; try to parse stdout.
  try {
    const out = e.stdout?.toString() ?? '';
    const audit = JSON.parse(out);
    const vulns = audit.metadata?.vulnerabilities ?? {};
    console.log(`  info:${vulns.info ?? 0} low:${vulns.low ?? 0} moderate:${vulns.moderate ?? 0} high:${vulns.high ?? 0} critical:${vulns.critical ?? 0}`);
  } catch {
    console.log('  (could not parse npm audit output)');
  }
}

process.exit(findings.length === 0 ? 0 : 1);
