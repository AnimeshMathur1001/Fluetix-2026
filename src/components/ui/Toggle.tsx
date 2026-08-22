import { cn } from '../../lib/utils';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export default function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[18px] w-[34px] rounded-full border border-line2 transition-colors duration-120',
        checked ? 'bg-accent/35' : 'bg-field',
      )}
    >
      <span
        className={cn(
          'absolute top-px h-[14px] w-[14px] rounded-full transition-all duration-120',
          checked ? 'left-[17px] bg-accent' : 'left-px bg-mute2',
        )}
      />
    </button>
  );
}
