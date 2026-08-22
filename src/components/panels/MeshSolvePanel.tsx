import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, Play, Square } from 'lucide-react';
import SliderInput from '../ui/SliderInput';
import SelectInput from '../ui/SelectInput';
import NumericInput from '../ui/NumericInput';
import ActionButton from '../ui/ActionButton';
import MetricRow from '../ui/MetricRow';
import SectionTitle from '../ui/SectionTitle';
import Skeleton from '../ui/Skeleton';
import ResidualChart from './ResidualChart';
import RecommendationsCard from '../ui/RecommendationsCard';
import QuickEstimateCard from '../ui/QuickEstimateCard';
import UncertaintyBandCard from '../ui/UncertaintyBandCard';
import { useAppStore } from '../../store/useAppStore';
import { usePhysics } from '../../hooks/usePhysics';
import { useTasks } from '../../hooks/useTasks';
import { useSolver } from '../../hooks/useSolver';
import { useMeshIndependence } from '../../hooks/useMeshIndependence';
import { useTransientFlag } from '../../hooks/useTransientFlag';
import { cn, clamp, formatInt } from '../../lib/utils';
import { meshRecommendations } from '../../lib/recommendations';
import type { TurbulenceModel } from '../../lib/types';

function flagOf(value: number, warn: number, bad: number): [string, string] {
  if (value < warn) return ['ok', 'text-ok'];
  if (value < bad) return ['warn', 'text-warn'];
  return ['fail', 'text-bad'];
}

const LOG_TONE: Record<string, string> = {
  info: 'text-mute',
  ok: 'text-ok',
  warn: 'text-warn',
  error: 'text-bad',
};

export default function MeshSolvePanel() {
  const s = useAppStore();
  const { performance: perf, effectiveTurbulence } = usePhysics();
  const { runMesh } = useTasks();
  const solver = useSolver();
  const meshIndep = useMeshIndependence();

  const [levels, setLevels] = useState<[number, number, number]>(() => [
    clamp(s.bgCells - 4, 12, 60),
    s.bgCells,
    clamp(s.bgCells + 6, 12, 60),
  ]);

  const meshing = Boolean(s.busy?.label.startsWith('Meshing three regions'));
  const justMeshed = useTransientFlag(s.meshed && !meshing);

  const mesh = s.mesh;
  const skew = mesh ? flagOf(mesh.skewness, 4, 8) : null;
  const ar = mesh ? flagOf(mesh.aspectRatio, 20, 40) : null;
  const nonOrth = mesh ? flagOf(mesh.nonOrthogonality, 60, 75) : null;

  const recommendations = meshRecommendations({
    bgCells: s.bgCells,
    cellX: s.cellX,
    cellY: s.cellY,
    cellZ: s.cellZ,
    thickness: s.thickness,
    refine: s.refine,
    layers: s.layers,
    maxIterations: s.maxIterations,
    residualTarget: s.residualTarget,
    applyBgCells: (v) => s.set({ bgCells: v, meshed: false }),
    applyRefine: (v) => s.set({ refine: v, meshed: false }),
    applyLayers: (v) => s.set({ layers: v, meshed: false }),
    applyMaxIterations: (v) => s.set({ maxIterations: v }),
    applyResidualTarget: (v) => s.set({ residualTarget: v }),
  });

  return (
    <div className="px-4 pb-7 pt-4">
      <div className="mb-4 text-[14px] font-semibold">Mesh, solve &amp; jobs</div>

      <RecommendationsCard items={recommendations} />
      <QuickEstimateCard />

      <SectionTitle>Multi-region mesh</SectionTitle>
      <SliderInput
        label="Background cells / axis"
        readout={s.bgCells + '³'}
        min={12}
        max={60}
        step={2}
        value={s.bgCells}
        showNumeric={false}
        onChange={(v) => s.set({ bgCells: v, meshed: false })}
      />
      <SliderInput
        label="Surface refinement level"
        readout={'level ' + s.refine}
        min={0}
        max={4}
        step={1}
        value={s.refine}
        showNumeric={false}
        onChange={(v) => s.set({ refine: v, meshed: false })}
      />
      <SliderInput
        label="Boundary layers"
        readout={s.layers + ' layers'}
        min={0}
        max={6}
        step={1}
        value={s.layers}
        showNumeric={false}
        onChange={(v) => s.set({ layers: v, meshed: false })}
      />

      <ActionButton variant="outline" size="block" className="my-1.5 mb-3" onClick={runMesh} disabled={meshing}>
        {meshing ? (
          <Loader2 size={12} className="animate-spin" strokeWidth={2.2} />
        ) : justMeshed ? (
          <Check size={12} strokeWidth={2.6} />
        ) : null}
        Generate mesh
      </ActionButton>

      {mesh && skew && ar && nonOrth ? (
        <>
          <MetricRow divider label="Cells total" value={formatInt(mesh.cells) + ' k'} />
          <MetricRow
            divider
            label="hot / cold / solid"
            value={mesh.hot + ' / ' + mesh.cold + ' / ' + mesh.solid + ' k'}
          />
          <MetricRow divider label="Max skewness" value={mesh.skewness.toFixed(2)} flag={skew[0]} flagClassName={skew[1]} />
          <MetricRow divider label="Max aspect ratio" value={mesh.aspectRatio.toFixed(1)} flag={ar[0]} flagClassName={ar[1]} />
          <MetricRow
            divider
            label="Max non-orth."
            value={mesh.nonOrthogonality.toFixed(1) + '°'}
            flag={nonOrth[0]}
            flagClassName={nonOrth[1]}
          />
          <MetricRow divider label="Interfaces" value="2 fluid–solid" flag="ok" flagClassName="text-ok" />
        </>
      ) : s.busy?.label === 'Meshing three regions' ? (
        <div className="py-1">
          {[88, 120, 76, 92, 100].map((w, i) => (
            <div key={i} className="flex items-center justify-between border-b border-white/[0.04] py-1.5">
              <Skeleton className="h-[10px]" style={{ width: w }} />
              <Skeleton className="h-[10px] w-12" />
            </div>
          ))}
          <div className="mt-1.5 text-xxs text-mute3">{s.busy.detail}</div>
        </div>
      ) : (
        <MetricRow label="Status" value="no mesh" valueClassName="text-mute2" />
      )}

      <SectionTitle className="mt-4">Flow regime</SectionTitle>
      <MetricRow
        label="Re — hot"
        value={perf.hot.reynolds.toFixed(0)}
        valueClassName={perf.hot.reynolds < 2300 ? 'text-ok' : 'text-warn'}
      />
      <MetricRow
        label="Re — cold"
        value={perf.cold.reynolds.toFixed(0)}
        valueClassName={perf.cold.reynolds < 2300 ? 'text-ok' : 'text-warn'}
      />
      <MetricRow label="Dₕ" value={(perf.hydraulicDiameter * 1000).toFixed(2) + ' mm'} />
      <MetricRow
        label="Bulk velocity"
        value={perf.hot.velocity.toFixed(3) + ' / ' + perf.cold.velocity.toFixed(3) + ' m/s'}
      />
      <div className="my-2 text-xxs leading-relaxed text-accent">
        {perf.laminar
          ? 'Both streams below Re 2300 — laminar recommended. Selected: ' + effectiveTurbulence + '.'
          : 'At least one stream transitional/turbulent — k-ω SST recommended. Selected: ' +
            effectiveTurbulence +
            '.'}
      </div>
      <SelectInput
        value={s.turbulence}
        onChange={(v) => s.set({ turbulence: v as TurbulenceModel, converged: null })}
        options={[
          { value: 'auto', label: 'Auto (recommend from Re) — ' + effectiveTurbulence },
          { value: 'laminar', label: 'Laminar' },
          { value: 'kOmegaSST', label: 'k-ω SST' },
          { value: 'kEpsilon', label: 'k-ε realizable' },
        ]}
      />

      <SectionTitle className="mt-4">Solve</SectionTitle>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex-1 whitespace-nowrap text-smx text-dim">Residual target</span>
        <SelectInput
          className="w-[92px] flex-none"
          value={s.residualTarget}
          onChange={(v) => s.set({ residualTarget: v })}
          options={[
            { value: '1e-4', label: '1e-4' },
            { value: '1e-5', label: '1e-5' },
            { value: '1e-6', label: '1e-6' },
          ]}
        />
      </div>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex-1 whitespace-nowrap text-smx text-dim">Max iterations</span>
        <NumericInput
          align="right"
          className="w-[92px]"
          step={100}
          value={s.maxIterations}
          onChange={(v) => s.set({ maxIterations: v })}
        />
      </div>
      <div className="mb-3 flex gap-2">
        <ActionButton variant="primary" size="block" onClick={solver.start} disabled={s.solving}>
          <Play size={12} strokeWidth={2} />
          {s.solving ? 'Solving…' : 'Run solve'}
        </ActionButton>
        <ActionButton className="whitespace-nowrap" onClick={solver.cancel}>
          <Square size={11} strokeWidth={2} />
          Cancel
        </ActionButton>
      </div>

      <ResidualChart />

      <div className="mt-4 border-t border-line pt-3.5">
        <SectionTitle>Mesh independence study</SectionTitle>
        <div className="mb-2 text-xxs leading-relaxed text-mute3">
          Reruns the full real meshing-and-solving pipeline at each
          background-cell resolution below and reports how
          far Δp and effectiveness move between them — the standard check
          that a result isn't an artifact of mesh coarseness. Distinct from
          the periodicity check below (still synthetic); this one is genuine
          end-to-end, so each resolution is a real multi-minute solve.
        </div>
        <div className="mb-2 flex gap-1.5">
          {([0, 1, 2] as const).map((i) => (
            <NumericInput
              key={i}
              align="right"
              className="min-w-0 flex-1"
              value={levels[i]}
              onChange={(v) => setLevels((prev) => {
                const next = [...prev] as [number, number, number];
                next[i] = clamp(Math.round(v), 12, 60);
                return next;
              })}
            />
          ))}
        </div>
        <ActionButton
          variant="outline"
          size="block"
          className="mb-2"
          disabled={s.meshIndependence.running}
          onClick={() => meshIndep.start([...levels].sort((a, b) => a - b))}
        >
          {s.meshIndependence.running ? 'Running…' : 'Run mesh independence study (3 real solves)'}
        </ActionButton>

        {s.meshIndependence.running ? (
          <div className="mb-2 space-y-1 text-xxs">
            <div className="text-muted">
              {s.meshIndependence.levels.filter((lv) => lv.phase === 'done').length}/{s.meshIndependence.levelTotal} resolutions complete — running concurrently
            </div>
            {s.meshIndependence.levels.map((lv) => (
              <div key={lv.level} className="flex items-center justify-between text-accent">
                <span>bgCells={lv.level}</span>
                <span>{lv.phase === 'solving' ? 'solving, iter ' + lv.iteration : lv.phase}</span>
              </div>
            ))}
            <ActionButton className="mt-1 inline-flex" onClick={meshIndep.cancel}>
              Cancel
            </ActionButton>
          </div>
        ) : null}

        {s.meshIndependence.error ? (
          <div className="mb-2 text-xxs text-bad">{s.meshIndependence.error}</div>
        ) : null}

        {s.meshIndependence.results.length > 0 ? (
          <div className="mb-3 overflow-x-auto rounded border border-line">
            <table className="w-full border-collapse font-mono text-2xs">
              <thead>
                <tr className="border-b border-line text-mute2">
                  <th className="px-2 py-1 text-left">bgCells</th>
                  <th className="px-2 py-1 text-right">cells</th>
                  <th className="px-2 py-1 text-right">Δp hot [Pa]</th>
                  <th className="px-2 py-1 text-right">Δp cold [Pa]</th>
                  <th className="px-2 py-1 text-right">ε</th>
                </tr>
              </thead>
              <tbody>
                {s.meshIndependence.results.map((r, i) => (
                  <motion.tr
                    key={r.level}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: i * 0.06 }}
                    className="border-b border-line/50 text-dim2"
                  >
                    <td className="px-2 py-1">{r.level}</td>
                    <td className="px-2 py-1 text-right">{formatInt(r.cells)}</td>
                    <td className="px-2 py-1 text-right">{r.performance.hot.pressureDrop.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right">{r.performance.cold.pressureDrop.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right">{r.performance.effectiveness.toFixed(4)}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
            {s.meshIndependence.convergence ? (
              <div className="border-t border-line px-2 py-1.5 text-2xs text-mute3">
                {s.meshIndependence.convergence.rows.map((row) => (
                  <div key={row.metric}>
                    {row.metric}: {row.percentChange.map((p) => p.toFixed(1) + '%').join(' → ')} change between
                    successive levels
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {s.meshIndependence.gciRows?.some(r => r.gci) && (
          <div className="mt-4">
            <div className="mb-2 text-smx font-semibold text-ink">
              Grid Convergence Index
            </div>
            {s.meshIndependence.gciRows
              .filter(r => r.gci !== null)
              .map(r => (
                <div
                  key={r.metric}
                  className="mb-3 rounded bg-card p-3 text-smx"
                >
                  <div className="mb-1 font-medium text-ink">
                    {r.metric}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-dim">
                    <span>Observed order p</span>
                    <span className="text-ink">
                      {r.gci!.observedOrder.toFixed(2)}
                    </span>
                    <span>Richardson extrapolated</span>
                    <span className="text-ink">
                      {r.gci!.richardsonExtrapolated.toFixed(4)}
                    </span>
                    <span>GCI fine grid</span>
                    <span className={
                      r.gci!.converged
                        ? 'font-semibold text-ok'
                        : 'font-semibold text-warn'
                    }>
                      {r.gci!.gciFineGridPct.toFixed(2)} %
                      {r.gci!.converged
                        ? ' — mesh independent'
                        : ' — refine further'}
                    </span>
                    <span>Refinement ratios</span>
                    <span className="text-ink">
                      r21 = {r.gci!.r21.toFixed(2)},
                      r32 = {r.gci!.r32.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            <div className="mt-1 text-xs text-dim">
              Procedure: Celik I.B. et al., ASME J. Fluids Eng. 130(7)
              078001, 2008. Safety factor 1.25. GCI below 2 % indicates
              mesh-independent results.
            </div>
          </div>
        )}
      </div>

      <UncertaintyBandCard />

      <div className="mt-4 border-t border-line pt-3.5">
        <SectionTitle>Server status</SectionTitle>
        {s.backend.available ? (
          s.queueStatus ? (
            <>
              <MetricRow
                label="Jobs running"
                value={s.queueStatus.running + ' / ' + s.queueStatus.maxConcurrent}
                valueClassName={s.queueStatus.running > 0 ? 'text-accent' : 'text-ink2'}
              />
              <MetricRow
                label="Jobs waiting"
                value={String(s.queueStatus.waiting)}
                valueClassName={s.queueStatus.waiting > 0 ? 'text-warn' : 'text-ink2'}
              />
              <MetricRow label="Active sessions" value={String(s.queueStatus.sessions)} />
            </>
          ) : (
            <div className="text-xxs text-mute3">Checking server load…</div>
          )
        ) : (
          <div className="text-xxs text-mute3">Not connected — meshing and solving run as an in-browser estimate only.</div>
        )}

        <div className="mb-2 mt-3 text-base2 font-semibold">Job status</div>
        <MetricRow
          label="Status"
          value={s.jobStatus}
          valueClassName={
            s.jobStatus === 'done'
              ? 'text-ok'
              : s.jobStatus === 'failed' || s.jobStatus === 'cancelled'
                ? 'text-bad'
                : s.jobStatus === 'running' || s.jobStatus === 'queued'
                  ? 'text-accent'
                  : 'text-mute2'
          }
        />
        <div className="mt-2 h-[104px] overflow-y-auto rounded border border-line bg-console p-2 font-mono text-[10px] leading-relaxed">
          {s.jobLog.length === 0 ? (
            <div className="text-mute3">no job log yet</div>
          ) : (
            s.jobLog.map((l, i) => (
              <div key={i} className={cn('whitespace-pre-wrap', LOG_TONE[l.tone])}>
                {l.text}
              </div>
            ))
          )}
        </div>
        <div className="mt-2 text-xxs leading-relaxed text-mute3">
          The solver is CPU-only; no GPU coupling in this build. Jobs beyond the server's concurrent
          limit queue automatically and start as soon as a slot frees up.
        </div>
      </div>
    </div>
  );
}
