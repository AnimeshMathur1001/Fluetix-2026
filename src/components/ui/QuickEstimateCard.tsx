import { Gauge, Loader2 } from 'lucide-react';
import ActionButton from './ActionButton';
import SectionTitle from './SectionTitle';
import { useAppStore } from '../../store/useAppStore';
import { fetchEstimate, EstimateUnavailableError } from '../../lib/api';
import { cn } from '../../lib/utils';

function confidenceLabel(confidence: number): [string, string] {
  if (confidence >= 0.66) return ['high confidence', 'text-ok'];
  if (confidence >= 0.33) return ['medium confidence', 'text-warn'];
  return ['low confidence', 'text-mute3'];
}

/** Instant performance estimate drawn from this server's own real solve
 * history (backend/app/services/surrogate.py) — a distance-weighted average
 * of previously solved cases with similar geometry and fluids, not a
 * simulation. Meant to sit before the multi-minute real solve below, so a
 * user can sanity-check a design direction before committing to it. Renders
 * nothing until the user asks for it, and shows the "not enough history yet"
 * case honestly rather than a fabricated number. */
export default function QuickEstimateCard() {
  const s = useAppStore();
  const qe = s.quickEstimate;

  const run = async () => {
    if (!s.backend.available) {
      s.flash('Quick estimate needs a live connection');
      return;
    }
    s.set({ quickEstimate: { loading: true, result: null, unavailableReason: null } });
    try {
      const result = await fetchEstimate({
        surface: s.surface, cellX: s.cellX, cellY: s.cellY, cellZ: s.cellZ,
        thickness: s.thickness, grading: s.grading, hot: s.hot, cold: s.cold, solid: s.solid,
      });
      s.set({ quickEstimate: { loading: false, result, unavailableReason: null } });
    } catch (e) {
      s.set({
        quickEstimate: {
          loading: false,
          result: null,
          unavailableReason: e instanceof EstimateUnavailableError ? e.message : 'Estimate unavailable',
        },
      });
    }
  };

  if (!s.backend.available) return null;

  return (
    <div className="mb-3.5 rounded-md border border-line bg-panel2 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Gauge size={12} strokeWidth={1.9} className="text-dim" />
        <SectionTitle className="mb-0">Quick estimate</SectionTitle>
      </div>

      <ActionButton variant="outline" size="block" className="mb-2" onClick={run} disabled={qe.loading}>
        {qe.loading ? <Loader2 size={11} className="animate-spin" strokeWidth={2.2} /> : null}
        {qe.loading ? 'Estimating…' : 'Estimate before running a full solve'}
      </ActionButton>

      {qe.result ? (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between">
            <span className="text-smx text-mute">Effectiveness ε</span>
            <span className="font-mono text-smx text-ink2">{qe.result.effectiveness.toFixed(3)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-smx text-mute">Δp hot / cold</span>
            <span className="font-mono text-smx text-ink2">
              {qe.result.pressureDropHot.toFixed(0)} / {qe.result.pressureDropCold.toFixed(0)} Pa
            </span>
          </div>
          <div className={cn('mt-1.5 text-xxs', confidenceLabel(qe.result.confidence)[1])}>
            {confidenceLabel(qe.result.confidence)[0]} — based on {qe.result.basedOn} of {qe.result.sampleSize} similar
            solved case{qe.result.sampleSize === 1 ? '' : 's'} on this surface type
          </div>
          <div className="mt-1 text-xxs leading-relaxed text-mute3">
            Distance-weighted average of real prior solves, not a new simulation — run a full solve for a verified
            result.
          </div>
        </div>
      ) : qe.unavailableReason ? (
        <div className="text-xxs leading-relaxed text-mute3">{qe.unavailableReason}</div>
      ) : null}
    </div>
  );
}
