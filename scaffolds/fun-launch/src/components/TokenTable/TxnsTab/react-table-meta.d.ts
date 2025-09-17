// Module augmentation for @tanstack/react-table to add meta properties
import type { DateMode } from './datemode';

declare module '@tanstack/react-table' {
  interface TableMeta {
    dateMode: DateMode;
    setDateMode: (mode: DateMode) => void;
    walletAddress: string | undefined;
    symbol: string | undefined;
  }
}
