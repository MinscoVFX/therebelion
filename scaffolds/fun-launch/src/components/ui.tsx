import { FC, InputHTMLAttributes, ChangeEvent } from 'react';

export const Input: FC<InputHTMLAttributes<HTMLInputElement>> = ({ className = '', ...props }) => (
  <input
    className={`bg-neutral-800 text-white border border-neutral-700/60 rounded px-3 py-2 focus:ring-indigo-400/60 focus:border-indigo-400 ${className}`}
    {...props}
  />
);

export const Slider: FC<{
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}> = ({ value, onChange, min = 0, max = 1000, step = 10, className = '' }) => (
  <input
    type="range"
    value={value}
    onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
    min={min}
    max={max}
    step={step}
    className={`w-full accent-indigo-500 ${className}`}
  />
);
