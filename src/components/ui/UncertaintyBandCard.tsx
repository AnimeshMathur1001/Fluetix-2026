import { useState } from 'react';
import ActionButton from './ActionButton';
import SectionTitle from './SectionTitle';
import NumericInput from './NumericInput';
import { useAppStore } from '../../store/useAppStore';
import { useUncertaintyBand } from '../../hooks/useUncertaintyBand';

const METRIC_LABEL: Record<string, string> = {
  'hot.pressureDrop': 'Δp hot',
  'cold.pressureDrop': 'Δp cold',
  effectiveness: 'Effectiveness ε',
};

/** One real solved case's performance band under a manufacturing wall-
 * thickness tolerance — three full mesh+solve runs (nominal, minus, plus),
 * not an error bar drawn around a single point. See
 * backend/app/routers/uncertainty.py. */
export default function UncertaintyBandCard() {
  const s = useAppStore();
  const uncertainty = useUncertaintyBand();
  const [tolerance, setTolerance] = useState(0.05);

  return (
    <div className="mt-4 border-t border-line pt-3.5">
      <SectionTitle>Manufacturing-tolerance sensitivity</SectionTitle>
      <div className="mb-2 text-xxs leading-relaxed text-mute3">
        Reruns the real pipeline at this case's wall thickness and at thickness ± the tolerance below, reporting a
        real performance band instead of one number that assumes the as-printed part comes out exact.
      </div>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex-1 whitespace-nowrap text-smx text-dim">Thickness tolerance</span>
        <NumericInput align="right" className="w-[92px]" step={0.01} min={0.01} value={tolerance} onChange={(v) => setTolerance(Math.max(0.01, v))} />
        <span className="text-xxs text-mute3">mm</span>
      </div>

      <ActionButton
        variant="outline"
        size="block"
        className="mb-2"
        disabled={s.uncertainty.running}
        onClick={() => uncertainty.start(tolerance)}
      >
        {s.uncertainty.running ? 'Running…' : 'Run tolerance sensitivity (3 real solves)'}
      </ActionButton>

      {s.uncertainty.running ? (
        <div className="mb-2 space-y-1 text-xxs text-accent">
          <div>
            {s.uncertainty.variants.length}/3 variants complete — currently {s.uncertainty.currentVariant}
          </div>
          <ActionButton className="mt-1 inline-flex" onClick={uncertainty.cancel}>
            Cancel
          </ActionButton>
        </div>
      ) : null}

      {s.uncertainty.error ? <div className="mb-2 text-xxs text-bad">{s.uncertainty.error}</div> : null}

      {s.uncertainty.bands && s.uncertainty.bands.length > 0 ? (
        <div className="mb-3 overflow-hidden rounded border border-line">
          {s.uncertainty.bands.map((row) => {
            const span = row.max - row.min || 1e-9;
            const nominalPct = Math.min(100, Math.max(0, ((row.nominal - row.min) / span) * 100));
            return (
              <div key={row.metric} className="border-b border-line/50 px-2.5 py-2 last:border-b-0">
                <div className="mb-1 flex items-baseline justify-between font-mono text-2xs">
                  <span className="text-mute2">{METRIC_LABEL[row.metric] ?? row.metric}</span>
                  <span className="text-ink2">
                    {row.nominal.toFixed(row.metric === 'effectiveness' ? 4 : 1)} ± {row.spreadPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="relative h-1.5 rounded-full bg-white/[0.06]">
                  <div className="absolute inset-y-0 rounded-full bg-accent/30" style={{ left: 0, right: 0 }} />
                  <div
                    className="absolute top-1/2 h-2.5 w-[3px] -translate-y-1/2 rounded-full bg-accent"
                    style={{ left: nominalPct + '%' }}
                  />
                </div>
                <div className="mt-1 flex justify-between font-mono text-2xs text-mute3">
                  <span>{row.min.toFixed(row.metric === 'effectiveness' ? 4 : 1)}</span>
                  <span>{row.max.toFixed(row.metric === 'effectiveness' ? 4 : 1)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
