import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

interface MetricRowProps {
  label: string;
  value: string;
  unit?: string;
  flag?: string;
  valueClassName?: string;
  flagClassName?: string;
  divider?: boolean;
  large?: boolean;
}

/** One label / value line. Both halves are nowrap so a long label can never overlap its value.
 *  The value briefly flashes on change (not on mount) so a live-recomputed number — Reynolds,
 *  mesh cells, a result after a solve — reads as an update rather than silently jumping. */
export default function MetricRow({
  label,
  value,
  unit,
  flag,
  valueClassName = 'text-ink2',
  flagClassName = 'text-mute2',
  divider = false,
  large = false,
}: MetricRowProps) {
  const prevValue = useRef(value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (prevValue.current === value) return;
    prevValue.current = value;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 500);
    return () => window.clearTimeout(t);
  }, [value]);

  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-1',
        divider && 'border-b border-white/[0.04]',
      )}
    >
      <span className="whitespace-nowrap text-smx text-mute">{label}</span>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span
          className={cn(
            '-mx-1 rounded px-1 font-mono transition-colors duration-300',
            large ? 'text-base2' : 'text-smx',
            valueClassName,
            flash && 'bg-accent/20',
          )}
        >
          {value}
        </span>
        {unit ? <span className="w-11 font-mono text-xxs text-mute3">{unit}</span> : null}
        {flag ? <span className={cn('font-mono text-2xs', flagClassName)}>{flag}</span> : null}
      </span>
    </div>
  );
}
