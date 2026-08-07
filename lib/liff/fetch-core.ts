/**
 * Transport-agnostic authenticated-fetch core (no `liff`/DOM — unit-testable).
 *
 * Sends a request with a fresh token; on a 401 it re-initialises the session
 * ONCE, gets a fresh token, and retries ONCE. Never loops.
 */
export interface AuthRetryDeps {
  /** Obtain a fresh access token (throws if the session cannot provide one). */
  getToken: () => Promise<string>;
  /** Re-initialise the LIFF session (called at most once, on a 401). */
  reinit: () => Promise<void>;
  /** Perform the actual request with the given bearer token. */
  doFetch: (token: string) => Promise<Response>;
}

export async function fetchWithAuthRetry(deps: AuthRetryDeps): Promise<Response> {
  const first = await deps.getToken();
  const res = await deps.doFetch(first);
  if (res.status !== 401) return res;

  // One recovery attempt: fresh session + fresh token + single retry.
  await deps.reinit();
  const second = await deps.getToken();
  return deps.doFetch(second);
}
