import { NextResponse } from 'next/server';
// Using relative import instead of alias to satisfy ESLint path resolution
import { getRuntimeHealth } from '../../../server/studioRuntime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const runtime = await getRuntimeHealth();
    return NextResponse.json({ ok: true, runtime });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'unknown' }, { status: 500 });
  }
}
