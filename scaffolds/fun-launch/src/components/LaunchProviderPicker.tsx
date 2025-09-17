// scaffolds/fun-launch/src/components/LaunchProviderPicker.tsx
import * as React from 'react';
import type { LaunchProvider } from '@/types/launch';

type Props = {
  value: LaunchProvider;
  onChange: (provider: LaunchProvider) => void;
  disabled?: boolean;
  className?: string;
};

const labelBase = 'block text-sm font-medium leading-6';
const helpBase = 'mt-1 text-xs opacity-70';
const containerBase = 'flex items-center gap-4';

export function LaunchProviderPicker({ value, onChange, disabled, className }: Props) {
  return (
    <div className={className}>
      <label className={labelBase}>Launch on</label>
      <div className={containerBase} role="radiogroup" aria-label="Launch provider">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="provider"
            value="meteora"
            checked={value === 'meteora'}
            onChange={() => onChange('meteora')}
            disabled={disabled}
          />
          <span>Meteora DBC</span>
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="provider"
            value="raydium"
            checked={value === 'raydium'}
            onChange={() => onChange('raydium')}
            disabled={disabled}
          />
          <span>Raydium LaunchLab</span>
        </label>
      </div>
      <p className={helpBase}>
        Tip: Raydium adds a protocol fee (0.25%) on trades; your platform fee is separate.
      </p>
    </div>
  );
}

export default LaunchProviderPicker;
