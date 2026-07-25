import { NextResponse } from 'next/server';
import { env, validateEnvironment } from '@/lib/env';
import { getSheetsClient } from '@/lib/sheets/client';
import { validateSheetsSchema } from '@/lib/sheets/schema-validator';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CheckStatus = 'ok' | 'fail' | 'skipped';

/**
 * Readiness probe. Verifies configuration and connectivity WITHOUT sending any
 * real LINE message or leaking secrets. Returns 503 when not ready.
 */
export async function GET(): Promise<NextResponse> {
  const checks: Record<string, CheckStatus> = {
    environment: 'ok',
    googleSheets: 'ok',
    sheetSchema: 'ok',
    appsScriptConfig: 'ok',
    lineConfig: 'ok',
  };

  // Environment.
  const envReport = validateEnvironment();
  if (!envReport.ok) checks.environment = 'fail';

  // Apps Script URL parse.
  const gasUrl = env.googleAppsScriptUrl();
  if (!gasUrl) checks.appsScriptConfig = 'fail';
  else {
    try {
      void new URL(gasUrl);
    } catch {
      checks.appsScriptConfig = 'fail';
    }
  }

  // LINE config: tokens/secret present with a plausible minimum length.
  const empTok = process.env.EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN ?? '';
  const mgrTok = process.env.MANAGER_LINE_CHANNEL_ACCESS_TOKEN ?? '';
  const mgrSecret = process.env.MANAGER_LINE_CHANNEL_SECRET ?? '';
  if (empTok.length < 20 || mgrTok.length < 20 || mgrSecret.length < 20) {
    checks.lineConfig = 'fail';
  }

  // Google Sheets connectivity + schema.
  if (!env.googleSheetId() || !env.googleClientEmail() || !env.googlePrivateKey()) {
    checks.googleSheets = 'fail';
    checks.sheetSchema = 'skipped';
  } else {
    try {
      const { sheets, spreadsheetId } = await getSheetsClient();
      const report = await validateSheetsSchema({ sheets, spreadsheetId });
      checks.sheetSchema = report.ok ? 'ok' : 'fail';
    } catch (err) {
      logger.error('ready_sheets_check_failed', {
        route: 'GET /api/ready',
        result: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
      checks.googleSheets = 'fail';
      checks.sheetSchema = 'fail';
    }
  }

  const ready = Object.values(checks).every((c) => c === 'ok' || c === 'skipped');
  return NextResponse.json(
    { status: ready ? 'ready' : 'not_ready', checks },
    { status: ready ? 200 : 503 },
  );
}
