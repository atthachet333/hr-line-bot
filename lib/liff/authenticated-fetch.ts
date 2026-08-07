'use client';

import type { LiffPage } from './config';
import { getFreshLiffAccessToken, reinitializeLiffSession, clearReloginMark } from './session';
import { fetchWithAuthRetry } from './fetch-core';

export interface AuthedFetchInit {
  method?: string;
  /** JSON body (serialised) OR a FormData/Blob body passed through as-is. */
  body?: BodyInit;
  headers?: Record<string, string>;
}

/**
 * Fetch an app API with a FRESH LIFF access token as `Authorization: Bearer`,
 * `cache: no-store`. On a 401 it re-initialises the LIFF session once, gets a
 * fresh token, and retries once (never loops). A non-401 response clears the
 * re-login loop guard so a later expiry can recover again. Throws LiffAuthError
 * when no token can be obtained (caller maps the code to a Thai message /
 * escalates to a full re-login).
 */
export async function authenticatedFetch(
  page: LiffPage,
  url: string,
  init: AuthedFetchInit = {},
): Promise<Response> {
  const doFetch = (token: string) =>
    fetch(url, {
      method: init.method ?? 'GET',
      cache: 'no-store',
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });

  const res = await fetchWithAuthRetry({
    getToken: () => getFreshLiffAccessToken(page),
    reinit: async () => {
      await reinitializeLiffSession(page);
    },
    doFetch,
  });
  if (res.status !== 401) clearReloginMark(page);
  return res;
}
