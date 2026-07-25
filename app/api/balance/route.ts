import { NextResponse } from 'next/server';
import { callAppsScript } from '@/lib/google-apps-script/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read-only balance / profile lookup. Proxies the `getBalance` action to the
 * Google Apps Script using the server-side URL (never exposed to the browser).
 *
 * Only the whitelisted `getBalance` action is forwarded so this cannot be used
 * as an open proxy to arbitrary Apps Script actions.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: 'error', message: 'invalid body' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const userId = typeof b.userId === 'string' ? b.userId : '';

  if (!userId) {
    return NextResponse.json({ status: 'error', message: 'userId is required' }, { status: 400 });
  }

  const result = await callAppsScript({ action: 'getBalance', userId });
  if (!result.ok) {
    console.error('balance lookup failed:', result.error);
    return NextResponse.json(
      { status: 'error', message: 'ไม่สามารถดึงข้อมูลได้ในขณะนี้' },
      { status: 502 },
    );
  }

  return NextResponse.json(result.data);
}
