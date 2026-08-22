import { cn } from '../../lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

export default function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={cn('flex gap-1.5', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex-1 rounded border px-1 py-1.5 text-tiny transition-colors duration-120',
              o.disabled
                ? 'cursor-not-allowed border-line2 bg-field text-dim2 opacity-40'
                : active
                  ? 'border-accent/45 bg-accent/10 text-accent shadow-raise'
                  : 'border-line2 bg-field text-dim2 hover:border-white/20 hover:text-ink2',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
