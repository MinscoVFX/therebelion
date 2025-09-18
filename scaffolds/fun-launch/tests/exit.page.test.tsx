/// <reference types="vitest" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, test, expect } from 'vitest';

// Mock hooks (relative to this test file)
vi.mock('../src/hooks/useDerivedDammV2Pools', () => ({
  useDerivedDammV2Pools: () => ({ loading: false, positions: [] as any[], error: null as any }),
}));
vi.mock('../src/hooks/useUniversalExit', () => ({
  useUniversalExit: () => ({ run: async () => {}, state: { running: false } as any }),
}));
vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => ({ connected: true, publicKey: null as any }),
}));

// Import the ExitPage from the scaffold (relative)
import ExitPage from '../src/app/exit/page';

describe('ExitPage', () => {
  test('disables Universal Exit button when no DAMM v2 positions', async () => {
    render(<ExitPage />);

    const buttons = await screen.findAllByRole('button');
    const btn = buttons.find((b) => b.textContent?.includes('No DAMM v2 positions'));
    expect(btn).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(btn!).toBeDisabled();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(btn!).toHaveTextContent(/No DAMM v2 positions/);
  });
});
