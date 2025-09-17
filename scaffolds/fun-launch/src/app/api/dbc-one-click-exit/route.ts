import { NextResponse } from 'next/server';

// Pre-migration: disable one-click DBC exit and steer users to Universal Exit
export async function POST(_req: Request) {
  return NextResponse.json(
    { error: 'Pre-migration exit unavailable; use Universal Exit' },
    { status: 501 }
  );
}
