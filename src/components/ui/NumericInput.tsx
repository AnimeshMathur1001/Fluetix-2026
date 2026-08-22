import { cn } from '../../lib/utils';

interface NumericInputProps {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
  align?: 'left' | 'right';
}

export default function NumericInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  className,
  align = 'left',
}: NumericInputProps) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number.parseFloat(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className={cn(
        'rounded border border-line2 bg-field px-1.5 py-1 font-mono text-tiny text-ink outline-none',
        'transition-colors duration-120 hover:border-white/20 focus:border-accent/60',
        align === 'right' && 'text-right',
        className,
      )}
    />
  );
}
