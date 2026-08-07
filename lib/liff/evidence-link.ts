import { isValidRequestId } from '@/lib/utils/request-id';

/**
 * Extract a leave requestId for the evidence viewer from a URL query string,
 * supporting both the plain `?requestId=...` form and LINE's `?liff.state=...`
 * wrapper (which itself contains the query). Returns '' unless the id matches
 * the strict REQ-YYYYMMDD-XXXXXXXX shape — so path traversal / junk is refused.
 */
export function parseEvidenceRequestId(search: string | null | undefined): string {
  if (!search) return '';
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  let id = sp.get('requestId') ?? '';
  if (!id) {
    const state = sp.get('liff.state');
    if (state) {
      const decoded = safeDecode(state);
      const inner = new URLSearchParams(decoded.startsWith('?') ? decoded.slice(1) : decoded);
      id = inner.get('requestId') ?? '';
    }
  }
  id = id.trim();
  return isValidRequestId(id) ? id : '';
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
