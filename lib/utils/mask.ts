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
