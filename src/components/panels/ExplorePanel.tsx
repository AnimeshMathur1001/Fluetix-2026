import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import SectionTitle from '../ui/SectionTitle';
import ActionButton from '../ui/ActionButton';
import NumericInput from '../ui/NumericInput';
import MetricRow from '../ui/MetricRow';
import { useAppStore } from '../../store/useAppStore';
import { useDesignExplorer } from '../../hooks/useDesignExplorer';
import { fetchDesignHistoryStats } from '../../lib/api';

/** Multi-objective design sweep over wall thickness and overall unit-cell
 * scale — a real Pareto front over effectiveness, pressure drop and solid
 * fraction (mass/print-cost proxy), where every point on the front was
 * actually meshed and solved, not predicted. See backend/app/routers/explorer.py. */
export default function ExplorePanel() {
  const s = useAppStore();
  const explorer = useDesignExplorer();

  const [thicknessMin, setThicknessMin] = useState(Math.max(0.2, s.thickness - 0.3));
  const [thicknessMax, setThicknessMax] = useState(s.thickness + 0.3);
  const [scaleMin, setScaleMin] = useState(0.8);
  const [scaleMax, setScaleMax] = useState(1.2);
  const [sampleCount, setSampleCount] = useState(6);
  const [historyStats, setHistoryStats] = useState<{ total: number; bySurface: Record<string, number> } | null>(null);

  useEffect(() => {
    if (!s.backend.available) return;
    fetchDesignHistoryStats().then(setHistoryStats);
  }, [s.backend.available, s.explorer.phase]);

  const surfaceHistory = historyStats?.bySurface[s.surface] ?? 0;

  const start = () =>
    explorer.start({
      thicknessRange: [thicknessMin, thicknessMax],
      cellScaleRange: [scaleMin, scaleMax],
      sampleCount,
    });

  return (
    <div className="px-4 pb-7 pt-4">
      <div className="mb-4 text-[14px] font-semibold">Design explorer</div>
      <div className="mb-3.5 text-xxs leading-relaxed text-mute3">
        Sweeps wall thickness and overall unit-cell scale, meshes and solves a handful of real candidates through the
        same pipeline as a normal solve, and reports which ones form a genuine Pareto front across effectiveness,
        pressure drop and solid fraction. {surfaceHistory > 0 ? `Pre-screens against ${surfaceHistory} previously solved ${s.surface} case${surfaceHistory === 1 ? '' : 's'} to pick promising candidates before spending real solve time on them.` : 'Not enough solve history yet to pre-screen – candidates are sampled evenly across the ranges below.'}
      </div>

      {!s.backend.available ? (
        <div className="mb-3 text-xxs text-mute3">The design explorer needs a live connection.</div>
      ) : null}

      <SectionTitle>Sweep ranges</SectionTitle>
      <div className="mb-2 flex items-center gap-2">
        <span className="w-24 flex-none text-smx text-dim">Thickness</span>
        <NumericInput align="right" className="min-w-0 flex-1" step={0.05} min={0.1} value={thicknessMin} onChange={setThicknessMin} />
        <span className="text-xxs text-mute3">to</span>
        <NumericInput align="right" className="min-w-0 flex-1" step={0.05} min={0.1} value={thicknessMax} onChange={setThicknessMax} />
        <span className="w-6 text-xxs text-mute3">mm</span>
      </div>
      <div className="mb-2 flex items-center gap-2">
        <span className="w-24 flex-none text-smx text-dim">Cell scale</span>
        <NumericInput align="right" className="min-w-0 flex-1" step={0.05} min={0.3} value={scaleMin} onChange={setScaleMin} />
        <span className="text-xxs text-mute3">to</span>
        <NumericInput align="right" className="min-w-0 flex-1" step={0.05} min={0.3} value={scaleMax} onChange={setScaleMax} />
        <span className="w-6 text-xxs text-mute3">×</span>
      </div>
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <span className="w-24 flex-none text-smx text-dim">Real solves</span>
          <NumericInput align="right" className="min-w-0 flex-1" step={1} min={2} max={10} value={sampleCount} onChange={(v) => setSampleCount(Math.min(10, Math.max(2, Math.round(v))))} />
        </div>
        <div className="mt-1 text-xxs text-mute3">candidates (each a full mesh + solve)</div>
      </div>

      <ActionButton
        variant="primary"
        size="block"
        className="mb-3"
        disabled={!s.backend.available || s.explorer.running}
        onClick={start}
      >
        {s.explorer.running ? 'Exploring…' : 'Run design explorer'}
      </ActionButton>

      {s.explorer.running ? (
        <div className="mb-3 space-y-1 text-xxs text-accent">
          <div>
            {s.explorer.poolSize > 0 ? `Screened ${s.explorer.poolSize} candidates (${s.explorer.screened ? 'surrogate-ranked' : 'evenly sampled'}) – ` : ''}
            {s.explorer.candidates.length}/{s.explorer.total} real solves complete
            {s.explorer.currentIndex != null ? `, running candidate ${s.explorer.currentIndex + 1}` : ''}
          </div>
          <ActionButton className="mt-1 inline-flex" onClick={explorer.cancel}>
            Cancel
          </ActionButton>
        </div>
      ) : null}

      {s.explorer.error ? <div className="mb-3 text-xxs text-bad">{s.explorer.error}</div> : null}

      {s.explorer.candidates.length > 0 ? (
        <>
          <SectionTitle>Real solved candidates</SectionTitle>
          <div className="mb-2 overflow-x-auto rounded border border-line">
            <table className="w-full border-collapse font-mono text-2xs">
              <thead>
                <tr className="border-b border-line text-mute2">
                  <th className="px-2 py-1 text-left">thickness</th>
                  <th className="px-2 py-1 text-right">scale</th>
                  <th className="px-2 py-1 text-right">solid frac.</th>
                  <th className="px-2 py-1 text-right">ε</th>
                  <th className="px-2 py-1 text-right">Δp avg [Pa]</th>
                  <th className="px-2 py-1 text-center">front</th>
                </tr>
              </thead>
              <tbody>
                {[...s.explorer.candidates]
                  .sort((a, b) => b.performance.effectiveness - a.performance.effectiveness)
                  .map((c, i) => (
                    <motion.tr
                      key={c.index}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, delay: i * 0.05 }}
                      className={c.paretoFront ? 'border-b border-line/50 bg-accent/[0.06] text-ink2' : 'border-b border-line/50 text-dim2'}
                    >
                      <td className="px-2 py-1">{c.thickness.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{c.cellScale.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{c.solidFraction != null ? (c.solidFraction * 100).toFixed(1) + '%' : '–'}</td>
                      <td className="px-2 py-1 text-right">{c.performance.effectiveness.toFixed(4)}</td>
                      <td className="px-2 py-1 text-right">{((c.performance.hot.pressureDrop + c.performance.cold.pressureDrop) / 2).toFixed(1)}</td>
                      <td className="px-2 py-1 text-center">{c.paretoFront ? '★' : ''}</td>
                    </motion.tr>
                  ))}
              </tbody>
            </table>
          </div>
          <MetricRow
            label="On the Pareto front"
            value={String(s.explorer.candidates.filter((c) => c.paretoFront).length) + ' / ' + s.explorer.candidates.length}
          />
        </>
      ) : null}
    </div>
  );
}
