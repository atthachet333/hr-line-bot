/**
 * Centralised, server-only access to environment variables.
 *
 * IMPORTANT: This module must only be imported from server code (Route Handlers,
 * repositories, services). Never import it from a Client Component, otherwise the
 * secrets would be bundled into the browser.
 */
import { z } from 'zod';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

/** Parse a comma / newline separated list into a trimmed, de-duplicated array. */
export function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
}

export const env = {
  // ---- Employee bot (LINE Messaging API + LIFF / LINE Login) ----
  employeeChannelAccessToken: () => required('EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN'),
  employeeChannelSecret: () => optional('EMPLOYEE_LINE_CHANNEL_SECRET'),
  /**
   * The LINE Login channel ID that the Employee LIFF app belongs to. Used as the
   * expected `aud` when verifying LIFF ID tokens. Falls back to the numeric prefix
   * of EMPLOYEE_LIFF_ID when not set explicitly.
   */
  employeeLoginChannelId: () => {
    const explicit = optional('EMPLOYEE_LINE_LOGIN_CHANNEL_ID');
    if (explicit) return explicit;
    const liffId = optional('EMPLOYEE_LIFF_ID') || optional('NEXT_PUBLIC_LIFF_ID');
    // LIFF IDs look like "1234567890-abcdEfgh"; the prefix is the channel ID.
    const prefix = liffId.split('-')[0];
    return prefix || '';
  },

  // ---- Manager bot (separate LINE Messaging API channel) ----
  managerChannelAccessToken: () => required('MANAGER_LINE_CHANNEL_ACCESS_TOKEN'),
  managerChannelSecret: () => required('MANAGER_LINE_CHANNEL_SECRET'),
  /** Group the manager notifications are pushed to (optional). */
  managerGroupId: () => optional('MANAGER_GROUP_ID'),
  /** Explicit list of manager LINE user IDs allowed to approve/reject. */
  managerUserIds: () => parseList(process.env.MANAGER_USER_IDS),

  /** LINE user IDs with HR-admin privileges (can override any request). */
  hrAdminUserIds: () => parseList(process.env.HR_ADMIN_USER_IDS),

  // ---- App ----
  appBaseUrl: () => optional('APP_BASE_URL'),
  /** Shared secret protecting internal admin endpoints (retry, etc). */
  internalApiSecret: () => optional('INTERNAL_API_SECRET'),
  nodeEnv: () => optional('NODE_ENV', 'development'),
  isProduction: () => optional('NODE_ENV') === 'production',

  // ---- Google ----
  googleClientEmail: () => optional('GOOGLE_CLIENT_EMAIL'),
  googlePrivateKey: () => optional('GOOGLE_PRIVATE_KEY'),
  googleAppsScriptUrl: () => optional('GOOGLE_APPS_SCRIPT_URL'),
  googleSheetId: () => optional('GOOGLE_SHEET_ID'),
  sheetNames: {
    leaveRequests: () => optional('SHEET_LEAVE_REQUESTS', 'LeaveRequests'),
    employees: () => optional('SHEET_EMPLOYEES', 'Employees'),
    auditLog: () => optional('SHEET_AUDIT_LOG', 'AuditLog'),
    holidays: () => optional('SHEET_HOLIDAYS', 'Holidays'),
  },

  // ---- Leave rules ----
  leaveCountWeekends: () => optional('LEAVE_COUNT_WEEKENDS', 'false') === 'true',

  // ---- Status transition safety ----
  /**
   * Whether the non-atomic read-check-write fallback may be used for status
   * transitions. Defaults to false. In production this must stay false so that
   * approvals only ever go through the atomic Apps Script LockService path.
   */
  allowNonAtomicTransition: () => optional('ALLOW_NON_ATOMIC_TRANSITION', 'false') === 'true',
};

/** True when a given manager LINE user id is authorised to approve/reject. */
export function isAuthorisedManager(lineUserId: string): boolean {
  const ids = env.managerUserIds();
  return ids.includes(lineUserId);
}

// ---------------------------------------------------------------------------
// Environment validation (used by /api/ready and `npm run validate:env`).
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /^(YOUR_|xxx|changeme|placeholder|example|<.*>)/i;

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_RE.test(value.trim());
}

/** A URL that is a valid absolute URL. In production it must also be HTTPS. */
function urlCheck(value: string, requireHttps: boolean): string | null {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return 'ไม่ใช่ URL ที่ถูกต้อง';
  }
  if (requireHttps && u.protocol !== 'https:') return 'Production ต้องเป็น HTTPS';
  if (requireHttps && /localhost|127\.0\.0\.1/.test(u.hostname)) {
    return 'Production ห้ามใช้ localhost';
  }
  return null;
}

export interface EnvCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const publicEnvSchema = z.object({
  NEXT_PUBLIC_LIFF_ID: z.string().optional(),
  NEXT_PUBLIC_LIFF_ID_BALANCE: z.string().optional(),
  NEXT_PUBLIC_LIFF_ID_CHECKIN: z.string().optional(),
  NEXT_PUBLIC_LIFF_ID_CHECKOUT: z.string().optional(),
});
export type PublicEnv = z.infer<typeof publicEnvSchema>;

/**
 * Validate the environment.
 *
 * @param opts.requireSecrets  When true (production/readiness), missing required
 *   secrets are errors. When false (unit tests / `validate:env` dev mode) they
 *   are downgraded to warnings so the check passes without real credentials.
 */
export function validateEnvironment(
  opts: { requireSecrets?: boolean; production?: boolean } = {},
): EnvCheckResult {
  const production = opts.production ?? env.isProduction();
  const requireSecrets = opts.requireSecrets ?? production;
  const errors: string[] = [];
  const warnings: string[] = [];

  const requiredSecrets: Array<[string, string | undefined]> = [
    ['EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN', process.env.EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN],
    ['MANAGER_LINE_CHANNEL_ACCESS_TOKEN', process.env.MANAGER_LINE_CHANNEL_ACCESS_TOKEN],
    ['MANAGER_LINE_CHANNEL_SECRET', process.env.MANAGER_LINE_CHANNEL_SECRET],
    ['GOOGLE_CLIENT_EMAIL', process.env.GOOGLE_CLIENT_EMAIL],
    ['GOOGLE_PRIVATE_KEY', process.env.GOOGLE_PRIVATE_KEY],
    ['GOOGLE_SHEET_ID', process.env.GOOGLE_SHEET_ID],
    ['GOOGLE_APPS_SCRIPT_URL', process.env.GOOGLE_APPS_SCRIPT_URL],
  ];

  for (const [name, value] of requiredSecrets) {
    if (!value || value.trim() === '') {
      (requireSecrets ? errors : warnings).push(`ขาดค่า ${name}`);
    } else if (isPlaceholder(value)) {
      errors.push(`${name} ยังเป็นค่าตัวอย่าง (placeholder)`);
    }
  }

  if (production && !process.env.INTERNAL_API_SECRET) {
    errors.push('Production ต้องตั้งค่า INTERNAL_API_SECRET');
  }

  // URL fields.
  for (const name of ['APP_BASE_URL', 'GOOGLE_APPS_SCRIPT_URL'] as const) {
    const value = process.env[name];
    if (value && value.trim() !== '') {
      const err = urlCheck(value, production);
      if (err) errors.push(`${name}: ${err}`);
    } else if (production) {
      errors.push(`Production ต้องตั้งค่า ${name}`);
    }
  }

  // Private key must contain the PEM markers and be \n-decodable.
  const pk = process.env.GOOGLE_PRIVATE_KEY;
  if (pk && pk.trim() !== '') {
    const decoded = pk.replace(/\\n/g, '\n');
    if (!decoded.includes('BEGIN') || !decoded.includes('PRIVATE KEY')) {
      errors.push('GOOGLE_PRIVATE_KEY ไม่ใช่ private key ที่ถูกต้อง');
    }
  }

  // Employee vs manager token must not be identical.
  const empTok = process.env.EMPLOYEE_LINE_CHANNEL_ACCESS_TOKEN;
  const mgrTok = process.env.MANAGER_LINE_CHANNEL_ACCESS_TOKEN;
  if (empTok && mgrTok && empTok === mgrTok) {
    errors.push('EMPLOYEE และ MANAGER access token ต้องไม่เหมือนกัน');
  }

  // A manager target must exist.
  if (!process.env.MANAGER_GROUP_ID && parseList(process.env.MANAGER_USER_IDS).length === 0) {
    (requireSecrets ? errors : warnings).push(
      'ต้องตั้งค่า MANAGER_GROUP_ID หรือ MANAGER_USER_IDS อย่างน้อยหนึ่งอย่าง',
    );
  }

  // Public LIFF ids must not be reused as a secret.
  const parsedPublic = publicEnvSchema.safeParse(process.env);
  if (!parsedPublic.success) {
    warnings.push('รูปแบบ NEXT_PUBLIC_LIFF_ID ไม่ถูกต้อง');
  }

  return { ok: errors.length === 0, errors, warnings };
}
