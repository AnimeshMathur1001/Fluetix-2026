import { useState } from 'react';
import NumericInput from './NumericInput';

interface SliderInputProps {
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  onChange: (value: number) => void;
  showNumeric?: boolean;
  readout?: string;
}

/** Paired slider + numeric input, the standard parameter control across all phases. */
export default function SliderInput({
  label,
  unit,
  value,
  min,
  max,
  step,
  hint,
  onChange,
  showNumeric = true,
  readout,
}: SliderInputProps) {
  const [dragging, setDragging] = useState(false);
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="whitespace-nowrap text-smx text-dim">{label}</span>
        <span className="whitespace-nowrap font-mono text-xxs text-mute2">{readout ?? unit}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1">
          {dragging && (
            <div
              className="pointer-events-none absolute bottom-[14px] -translate-x-1/2 whitespace-nowrap rounded border border-white/10 bg-[#14181d] px-1.5 py-0.5 font-mono text-2xs text-ink shadow-float"
              style={{ left: percent + '%' }}
            >
              {readout ?? value}
              {readout ? null : unit ? ' ' + unit : ''}
            </div>
          )}
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number.parseFloat(e.target.value))}
            onMouseDown={() => setDragging(true)}
            onMouseUp={() => setDragging(false)}
            onTouchStart={() => setDragging(true)}
            onTouchEnd={() => setDragging(false)}
            onBlur={() => setDragging(false)}
            className="w-full"
            style={{
              backgroundImage:
                'linear-gradient(to right, #e8a33d ' + percent + '%, rgba(255,255,255,0.14) ' + percent + '%)',
            }}
          />
        </div>
        {showNumeric && (
          <NumericInput value={value} min={min} max={max} step={step} onChange={onChange} className="w-[60px]" />
        )}
      </div>
      {hint ? <div className="mt-1 text-xxs text-mute3">{hint}</div> : null}
    </div>
  );
}
