import { cn } from '../../lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectInputProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  tone?: 'default' | 'accent';
}

export default function SelectInput({ value, options, onChange, className, tone = 'default' }: SelectInputProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'w-full rounded border bg-field px-1.5 py-1.5 text-tiny outline-none transition-colors duration-120',
        tone === 'accent' ? 'border-accent/30 text-accent' : 'border-line2 text-ink2',
        'hover:border-white/20 focus:border-accent/60',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-field text-ink">
          {o.label}
        </option>
      ))}
    </select>
  );
}
