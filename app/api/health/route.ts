import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness probe. Never calls external services. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
}
