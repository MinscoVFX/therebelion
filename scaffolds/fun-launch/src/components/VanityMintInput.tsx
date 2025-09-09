// scaffolds/fun-launch/src/components/VanityMintInput.tsx
import * as React from 'react';

type Props = {
  value?: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  errorText?: string;
  required?: boolean;
};

const labelBase = 'block text-sm font-medium leading-6';
const inputBase =
  'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-0';
const helpBase = 'mt-1 text-xs opacity-70';

const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function VanityMintInput({
  value = '',
  onChange,
  disabled,
  className,
  errorText,
  required,
}: Props) {
  // Force booleans so aria-invalid is strictly boolean (not string | boolean)
  const showInvalid: boolean = !!value && !base58Regex.test(value);
  const showError: boolean = Boolean(errorText) || showInvalid;

  return (
    <div className={className}>
      <label className={labelBase} htmlFor="vanityMint">
        Vanity Mint (optional)
      </label>
      <input
        id="vanityMint"
        name="vanityMint"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="Pre-generated mint address (base58)"
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        disabled={disabled}
        aria-invalid={showError}
        className={`${inputBase} ${showError ? 'ring-2 ring-red-500' : 'focus:ring-indigo-500'}`}
        required={required}
      />
      <p className={helpBase}>
        Provide a pre-generated mint to use a vanity address. Leave blank to auto-create the mint.
      </p>
      {showInvalid && !errorText ? (
        <p className="mt-1 text-xs text-red-600">Invalid base58 address.</p>
      ) : null}
      {errorText ? <p className="mt-1 text-xs text-red-600">{errorText}</p> : null}
    </div>
  );
}

export default VanityMintInput;
