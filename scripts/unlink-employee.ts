/**
 * Safely clear a wrong/stale LINE link for an employee so they can re-link.
 *
 * Usage:
 *   npm run employee:unlink -- S2A007            # dry-run: shows what would change
 *   npm run employee:unlink -- S2A007 --confirm  # actually clears lineUserId
 *
 * Only the lineUserId cell is cleared — the employee row is never deleted, and
 * the full LINE user id is never printed (masked only). Requires GOOGLE_* creds.
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
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const employeeId = args.find((a) => !a.startsWith('--'));

  if (!employeeId) {
    console.error('❌ กรุณาระบุรหัสพนักงาน เช่น: npm run employee:unlink -- S2A007 --confirm');
    process.exit(1);
  }

  if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.error('❌ ต้องตั้งค่า GOOGLE_SHEET_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY ก่อน');
    process.exit(1);
  }

  const { findByEmployeeId, unlinkEmployee } = await import('@/lib/repositories/employee-repository');
  const { maskId } = await import('@/lib/utils/mask');
  const auditLog = await import('@/lib/repositories/audit-log-repository');

  const found = await findByEmployeeId(employeeId);
  if (!found) {
    console.error(`❌ ไม่พบรหัสพนักงาน ${employeeId} ใน Employees sheet`);
    process.exit(1);
  }

  const { employee } = found;
  console.log('\nEmployee unlink');
  console.log('='.repeat(50));
  console.log(`  employeeId : ${employee.employeeId}`);
  console.log(`  name       : ${employee.name}`);
  console.log(`  lineUserId : ${employee.lineUserId ? maskId(employee.lineUserId) : '(ยังไม่ผูก)'}`);

  if (!employee.lineUserId) {
    console.log('\nℹ️  พนักงานคนนี้ยังไม่มี lineUserId — ไม่มีอะไรต้องล้าง');
    process.exit(0);
  }

  if (!confirm) {
    console.log('\n⚠️  โหมดตรวจสอบ (dry-run) — ยังไม่ได้แก้ไข');
    console.log('    รันซ้ำพร้อม --confirm เพื่อล้าง lineUserId ออกจากแถวนี้');
    console.log(`    ตัวอย่าง: npm run employee:unlink -- ${employee.employeeId} --confirm`);
    process.exit(0);
  }

  const result = await unlinkEmployee(employee.employeeId);
  if (result.status !== 'unlinked') {
    console.error(`❌ ไม่สามารถล้างได้ (สถานะ: ${result.status})`);
    process.exit(1);
  }

  await auditLog.append({
    requestId: employee.employeeId,
    action: 'EMPLOYEE_UNLINKED',
    actorName: 'HR_SCRIPT',
    detail: `unlinked ${employee.employeeId} (prev ${maskId(result.previousLineUserId)})`,
  });

  console.log(`\n✅ ล้าง lineUserId ของ ${employee.employeeId} เรียบร้อย — พนักงานสามารถผูกบัญชีใหม่ได้`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ unlink error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
