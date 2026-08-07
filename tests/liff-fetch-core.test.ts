import { describe, it, expect, vi } from 'vitest';
import { fetchWithAuthRetry } from '@/lib/liff/fetch-core';
import { sanitizeRedirectUri, maskLiffId } from '@/lib/liff/session-util';

function resp(status: number): Response {
  return new Response('x', { status });
}

describe('fetchWithAuthRetry', () => {
  it('returns immediately on success (no reinit)', async () => {
    const getToken = vi.fn().mockResolvedValue('t1');
    const reinit = vi.fn().mockResolvedValue(undefined);
    const doFetch = vi.fn().mockResolvedValue(resp(200));
    const r = await fetchWithAuthRetry({ getToken, reinit, doFetch });
    expect(r.status).toBe(200);
    expect(reinit).not.toHaveBeenCalled();
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('on 401 reinitialises ONCE, gets a FRESH token, retries ONCE', async () => {
    const getToken = vi.fn().mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh');
    const reinit = vi.fn().mockResolvedValue(undefined);
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(resp(401))
      .mockResolvedValueOnce(resp(200));
    const r = await fetchWithAuthRetry({ getToken, reinit, doFetch });
    expect(r.status).toBe(200);
    expect(reinit).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(doFetch).toHaveBeenNthCalledWith(1, 'stale');
    expect(doFetch).toHaveBeenNthCalledWith(2, 'fresh');
  });

  it('does not loop: a second 401 is returned as-is', async () => {
    const getToken = vi.fn().mockResolvedValue('t');
    const reinit = vi.fn().mockResolvedValue(undefined);
    const doFetch = vi.fn().mockResolvedValue(resp(401));
    const r = await fetchWithAuthRetry({ getToken, reinit, doFetch });
    expect(r.status).toBe(401);
    expect(reinit).toHaveBeenCalledTimes(1);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });
});

describe('session-util', () => {
  it('sanitizeRedirectUri drops query + hash', () => {
    expect(sanitizeRedirectUri('https://x.com/liff/balance?code=abc#frag')).toBe('https://x.com/liff/balance');
    expect(sanitizeRedirectUri('https://x.com/liff/leave')).toBe('https://x.com/liff/leave');
  });
  it('maskLiffId keeps only the channel prefix', () => {
    expect(maskLiffId('2010618791-6K8d8hmx')).toBe('2010618791-…');
    expect(maskLiffId('')).toBe('');
  });
});
