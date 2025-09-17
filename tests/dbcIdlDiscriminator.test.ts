/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import {
  resolveDbcIdl,
  anchorInstructionDiscriminator,
} from '../scaffolds/fun-launch/src/server/dbc-idl-utils';
import sampleIdl from '../dbc_idl.sample.json';

// Convert dynamic import type
interface SampleIdl {
  name: string;
  instructions: { name: string }[];
}

describe('DBC IDL discriminator resolution', () => {
  it('derives discriminators matching anchor formula', () => {
    const resolved = resolveDbcIdl(sampleIdl as unknown as SampleIdl);
    for (const ix of resolved.instructions) {
      const expected = anchorInstructionDiscriminator(ix.name);
      expect(ix.discriminator.equals(expected)).toBe(true);
    }
  });

  it('includes withdraw_liquidity instruction in sample', () => {
    const resolved = resolveDbcIdl(sampleIdl as any);
    const names = resolved.instructions.map((i) => i.name);
    expect(names).toContain('withdraw_liquidity');
  });
});
