import { env } from '@/lib/env';
import { getSheetsClient } from '@/lib/sheets/client';
import { nowIso } from '@/lib/utils/datetime';

const HEADER = [
  'timestamp',
  'requestId',
  'action',
  'actorLineUserId',
  'actorName',
  'fromStatus',
  'toStatus',
  'detail',
  'webhookEventId',
] as const;

export interface AuditEntry {
  requestId: string;
  action: string;
  actorLineUserId?: string;
  actorName?: string;
  fromStatus?: string;
  toStatus?: string;
  detail?: string;
  webhookEventId?: string;
}

function sheetName(): string {
  return env.sheetNames.auditLog();
}

async function ensureHeaders(): Promise<void> {
  const { sheets, spreadsheetId } = await getSheetsClient();
  const name = sheetName();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${name}!1:1` });
  const header = (res.data.values?.[0] as string[] | undefined) ?? [];
  if (header.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${name}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER as unknown as string[]] },
    });
  }
}

/** Append an audit entry. Best-effort: never throws to the caller. */
export async function append(entry: AuditEntry): Promise<void> {
  try {
    await ensureHeaders();
    const { sheets, spreadsheetId } = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName()}!A:I`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [
          [
            nowIso(),
            entry.requestId,
            entry.action,
            entry.actorLineUserId ?? '',
            entry.actorName ?? '',
            entry.fromStatus ?? '',
            entry.toStatus ?? '',
            entry.detail ?? '',
            entry.webhookEventId ?? '',
          ],
        ],
      },
    });
  } catch (err) {
    console.error('audit log append failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Returns true if a webhook event id has already been recorded in the audit log.
 * Used to make webhook processing idempotent against duplicate LINE deliveries.
 */
export async function hasWebhookEvent(webhookEventId: string): Promise<boolean> {
  if (!webhookEventId) return false;
  try {
    await ensureHeaders();
    const { sheets, spreadsheetId } = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName()}!I2:I`,
    });
    const ids = (res.data.values as string[][] | undefined) ?? [];
    return ids.some((row) => (row[0] ?? '') === webhookEventId);
  } catch {
    return false;
  }
}
