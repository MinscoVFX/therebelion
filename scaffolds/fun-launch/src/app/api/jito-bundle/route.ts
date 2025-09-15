import { NextResponse } from 'next/server';

// Placeholder returns a static list of tip accounts; real service would fetch from Jito API
export async function GET() {
  return NextResponse.json({ tipAccounts: ['11111111111111111111111111111111'] });
}
