import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Simple static test to ensure the exit page references withdraw_first action string
// so refactors don't accidentally revert to claim-only endpoint.

describe('Exit page withdraw_first usage', () => {
  it('contains action: \'withdraw_first\' in fetch body', () => {
    const p = path.join(process.cwd(), 'scaffolds/fun-launch/src/app/exit/page.tsx');
    const content = fs.readFileSync(p, 'utf8');
    expect(/action:\s*'withdraw_first'/.test(content)).toBe(true);
    expect(/\/api\/dbc-exit/.test(content)).toBe(true);
  });
});
