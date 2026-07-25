/**
 * Minimal structured logger. Emits one JSON line per event to stdout/stderr and
 * redacts sensitive values. This is the OPERATIONAL log — business/audit events
 * go through the audit-log repository instead.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEY_RE =
  /(token|secret|authorization|auth|password|private[_-]?key|id[_-]?token|access[_-]?token|signature|apikey|api[_-]?key)/i;

/** Keys whose values must never appear in logs, regardless of nesting. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // Redact obvious bearer tokens embedded in strings.
    return value.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]');
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

export interface LogFields {
  correlationId?: string;
  route?: string;
  event?: string;
  leaveRequestId?: string;
  actorType?: 'employee' | 'manager' | 'hr_admin' | 'system' | 'internal';
  result?: 'ok' | 'error' | 'denied' | 'skipped';
  durationMs?: number;
  code?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  const line = {
    level,
    time: new Date().toISOString(),
    message,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit('debug', message, fields),
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
};
