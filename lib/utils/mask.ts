/**
 * Mask an identifier (LINE userId / groupId) for logs. Keeps a short prefix and
 * suffix so entries are still correlatable, but never logs the full id.
 *   "U1234567890abcdef" -> "U123…cdef"
 */
export function maskId(id: string | undefined | null): string {
  if (!id) return '';
  const s = String(id);
  if (s.length <= 8) return `${s.slice(0, 2)}…`;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * Mask an employee id for logs, keeping a short prefix only, e.g.
 * "S2A007" -> "S2A***". Never logs the full code.
 */
export function maskEmployeeId(id: string | undefined | null): string {
  if (!id) return '';
  const s = String(id).trim();
  if (s.length <= 3) return `${s}***`;
  return `${s.slice(0, 3)}***`;
}
