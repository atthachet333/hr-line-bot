/**
 * Delete evidence files that are older than the retention window.
 *
 * Usage:
 *   npm run evidence:cleanup -- --dry-run    # report only, deletes nothing
 *   npm run evidence:cleanup -- --confirm    # actually delete + mark DELETED
 *
 * Rules: never touch PENDING requests; only delete files past
 * LEAVE_EVIDENCE_RETENTION_DAYS; every path is containment-checked under the
 * storage root; each deletion is audited (EVIDENCE_DELETED). Never prints an
 * absolute path or a full LINE user id.
 */
import { existsSync, readFileSync } from 'fs';

function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadDotEnv('.env.local');
loadDotEnv('.env');

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const dryRun = args.includes('--dry-run') || !confirm;

  const { env } = await import('@/lib/env');
  const root = env.leaveEvidenceDir();
  if (!root) {
    console.error('❌ LEAVE_EVIDENCE_DIR is not configured.');
    process.exit(1);
  }
  const retentionDays = env.leaveEvidenceRetentionDays();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const leaveRepo = await import('@/lib/repositories/leave-request-repository');
  const { deleteEvidence } = await import('@/lib/evidence/storage');
  const auditLog = await import('@/lib/repositories/audit-log-repository');

  const all = await leaveRepo.listAllRequests();
  const report = { scanned: 0, eligible: 0, skippedPending: 0, deleted: 0, errors: 0 };

  console.log(`\nEvidence cleanup (${dryRun ? 'DRY-RUN' : 'CONFIRM'}) — retention ${retentionDays} day(s)`);
  console.log('='.repeat(60));

  for (const r of all) {
    if (r.evidenceStatus !== 'AVAILABLE' || !r.evidenceRelativePath) continue;
    report.scanned += 1;
    if (r.status === 'PENDING') {
      report.skippedPending += 1;
      continue;
    }
    const basis = Date.parse(r.evidenceUploadedAt || r.createdAt || '');
    if (!Number.isFinite(basis) || basis > cutoff) continue; // not old enough
    report.eligible += 1;

    if (dryRun) {
      console.log(`  would delete: ${r.requestId} (${r.evidenceRelativePath.split('/').slice(0, 2).join('/')}/…)`);
      continue;
    }
    try {
      const removed = await deleteEvidence(root, r.evidenceRelativePath);
      await leaveRepo.setEvidenceMetadata(r.requestId, {
        evidenceStatus: 'DELETED',
        evidenceRelativePath: '',
        evidenceStoredFileName: '',
      });
      await auditLog.append({
        requestId: r.requestId,
        action: 'EVIDENCE_DELETED',
        detail: `retention ${retentionDays}d; fileRemoved=${removed}`,
      });
      report.deleted += 1;
      console.log(`  deleted: ${r.requestId}`);
    } catch (err) {
      report.errors += 1;
      console.error(`  error: ${r.requestId} — ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log('\nReport:', JSON.stringify(report));
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ cleanup error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
