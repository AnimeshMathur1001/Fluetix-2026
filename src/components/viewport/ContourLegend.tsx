import { COLOUR_RAMPS, FIELD_LABELS } from '../../lib/contours';
import { useAppStore } from '../../store/useAppStore';

export default function ContourLegend() {
  const step = useAppStore((s) => s.step);
  const field = useAppStore((s) => s.viewField);
  const range = useAppStore((s) => s.contourRange);
  const contourSource = useAppStore((s) => s.contourSource);
  const fetching = useAppStore((s) => s.fetchingSolvedField);

  if (step !== 4) return null;

  const digits = field === 'velocity' ? 3 : 1;
  const min = range ? range.min : 0;
  const max = range ? range.max : 1;

  return (
    <div className="absolute bottom-4 right-4 rounded-md border border-line2 bg-[#0e1115]/85 px-3 py-2.5 shadow-float backdrop-blur-md">
      <div className="mb-1.5 flex items-center gap-1.5 font-mono text-xxs text-dim2">
        <span>{FIELD_LABELS[field]}</span>
        <span
          className={
            'rounded-[3px] px-1 py-[1px] text-[9px] font-semibold uppercase tracking-wide ' +
            (contourSource === 'solved' ? 'bg-ok/15 text-ok' : 'bg-white/10 text-mute2')
          }
        >
          {contourSource === 'solved' ? 'solved · openfoam' : 'analytical preview'}
        </span>
        {fetching ? <span className="animate-pulse text-mute3">loading solved field…</span> : null}
      </div>
      <div className="flex items-center gap-2.5">
        <span className="w-[52px] text-right font-mono text-xxs text-ink2">{min.toFixed(digits)}</span>
        <span
          className="inline-block h-[9px] w-[130px] rounded-[2px]"
          style={{ background: COLOUR_RAMPS[field] }}
        />
        <span className="w-[52px] font-mono text-xxs text-ink2">{max.toFixed(digits)}</span>
      </div>
    </div>
  );
}
