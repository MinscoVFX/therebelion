import { NextResponse } from 'next/server';

// Pre-migration: disable one-click DBC exit and steer users to Universal Exit
export async function POST(_req: Request) {
  // Intentionally return a descriptive 4xx (not a 5xx) so smoke tests treat this as a non-fatal condition.
  // The one-click DBC exit (claim + withdraw) is disabled pre-migration. Use Universal Exit instead.
  return NextResponse.json(
    {
      error:
        'DBC one-click exit is disabled pre-migration; use Universal Exit (claims fees and removes DAMM v2 liquidity).',
    },
    { status: 400 }
  );
}
