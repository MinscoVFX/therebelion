export interface DbcPoolInfo {
  id: string; // stable id
  label: string;
  pool: string; // pool public key (base58)
  feeVault: string; // fee vault public key (base58)
  tags?: string[];
  totalLpRaw?: bigint; // aggregated LP amount (raw) if discovered
  lpMint?: string; // discovered lp mint (base58)
  primaryUserLpToken?: string; // user token account holding largest LP balance
}

// TODO: Replace placeholder keys with real on-chain addresses.
export const DBC_POOLS: DbcPoolInfo[] = [
  {
    id: 'example-1',
    label: 'Example Pool 1',
    pool: '11111111111111111111111111111111',
    feeVault: '11111111111111111111111111111111',
    tags: ['demo'],
  },
  {
    id: 'example-2',
    label: 'Example Pool 2',
    pool: '22222222222222222222222222222222',
    feeVault: '22222222222222222222222222222222',
    tags: ['demo'],
  },
];
