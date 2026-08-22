import { useMemo } from 'react';
import SegmentedControl from '../ui/SegmentedControl';
import SliderInput from '../ui/SliderInput';
import NumericInput from '../ui/NumericInput';
import MetricRow from '../ui/MetricRow';
import SectionTitle from '../ui/SectionTitle';
import ActionButton from '../ui/ActionButton';
import { useAppStore } from '../../store/useAppStore';
import { usePhysics } from '../../hooks/usePhysics';
import { buildReport } from '../../lib/report';
import { downloadText, toCSV } from '../../lib/exporters';
import { fetchReportPdf } from '../../lib/api';
import { geometryCache } from '../../lib/geometryCache';
import { checkEscapeHoles, checkOverhang, checkWallThickness, computeOverhang } from '../../lib/manufacturability';
import { cn, formatNumber } from '../../lib/utils';
import type { ClipAxis, FieldName, RegionKey } from '../../lib/types';

export default function ResultsPanel() {
  const s = useAppStore();
  const { performance: perf, scaleUp, effectiveTurbulence } = usePhysics();

  // Same recipe RegionsPanel uses — real checks against the actual generated
  // geometry, not re-derived here, just relayed into the report request.
  const overhang = useMemo(
    () => computeOverhang(geometryCache.positions, geometryCache.indices),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.stats.triangles, s.stats.ms],
  );
  const manufChecks = [checkWallThickness(s.thickness), ...checkEscapeHoles(s.faces), checkOverhang(overhang)];

  const balanceOk = perf.imbalance < 1;
  const backendDelta =
    s.backendPerformance && perf.Q !== 0 ? Math.abs((s.backendPerformance.Q - perf.Q) / perf.Q) * 100 : null;

  const header =
    s.converged === true
      ? 'Converged in ' + s.iteration + ' iterations · ' + effectiveTurbulence
      : s.converged === false
        ? 'Run did not converge — values below are not trustworthy'
        : s.solving
          ? 'Solving — iteration ' + s.iteration
          : 'No solve on record — values are from the correlation preview';

  const headerColour =
    s.converged === true
      ? 'text-ok'
      : s.converged === false
        ? 'text-bad'
        : s.solving
          ? 'text-accent'
          : 'text-mute2';

  const report = () => buildReport(s, perf, scaleUp, effectiveTurbulence);

  return (
    <div className="px-4 pb-7 pt-4">
      <div className="mb-1 text-[14px] font-semibold">Results</div>
      <div className={cn('mb-4 text-smx', headerColour)}>{header}</div>

      {s.backendPerformance && s.backendPerformance.imbalance > 5 && (
        <div className="mb-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-smx text-warn">
          CFD energy imbalance {s.backendPerformance.imbalance.toFixed(1)} % — the solid region has
          not fully converged. Run more iterations before treating these results as final.
        </div>
      )}

      {/* This banner is an internal consistency check between the frontend's own
          closed-form ε-NTU estimate and the backend's recomputation of that SAME
          formula (POST /cases -> GET /results) — it's unrelated to whether the
          Solved field (OpenFOAM) toggle below is active, and used to say so
          unconditionally even while showing real OpenFOAM data, which read as
          a direct contradiction. Only shown in analytical mode now. */}
      {s.backend.available && s.contourSource === 'analytical' ? (
        <div className="mb-4 text-xxs leading-relaxed text-mute3">
          {backendDelta !== null
            ? 'Verified: analytical Q agrees within ' + backendDelta.toFixed(3) + '% between the local and server-side calculation.'
            : 'Connected — verifying…'}
        </div>
      ) : null}

      <div className="mb-1.5 text-tiny text-dim2">Contour data</div>
      <SegmentedControl<'analytical' | 'solved'>
        className="mb-1.5"
        value={s.contourSource}
        onChange={(v) => {
          if (v === 'solved' && !(s.solvedFieldReady && s.meshed)) {
            s.flash('No completed solve on record — run "Run solve" on the Mesh & Solve step first');
            return;
          }
          const needsTemperature = v === 'solved' && s.viewRegion === 'solid' && s.viewField !== 'temperature';
          s.set({ contourSource: v, ...(needsTemperature ? { viewField: 'temperature' } : {}) });
        }}
        options={[
          { value: 'analytical', label: 'Analytical preview' },
          { value: 'solved', label: 'Solved field' },
        ]}
      />
      <div className="mb-3 text-xxs leading-relaxed text-mute3">
        {s.contourSource === 'solved'
          ? 'Real solver output, sampled onto this surface from the nearest solved cell.'
          : s.solvedFieldReady && s.meshed
            ? 'Closed-form estimate from the ε-NTU model — a completed solve is available, switch above to view it.'
            : 'Closed-form estimate from the ε-NTU model — not read from a solve. Run a solve on the Mesh & Solve step to view real field data here.'}
      </div>

      {/* Solid has no real solved U (never written) and its solved p is an inert
          uniform placeholder (see backend/README.md) — only T is real there.
          Gate both the region switch and the field buttons so a "solved"-mode
          user can't reach a combo the backend is designed to 422 on; a single
          such 422 used to silently kick the whole toggle back to analytical. */}
      <div className="mb-1.5 text-tiny text-dim2">Region</div>
      <SegmentedControl<RegionKey>
        className="mb-3"
        value={s.viewRegion}
        onChange={(v) => {
          const needsTemperature = s.contourSource === 'solved' && v === 'solid' && s.viewField !== 'temperature';
          s.set({ viewRegion: v, probe: null, ...(needsTemperature ? { viewField: 'temperature' } : {}) });
        }}
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'hot', label: 'Hot' },
          { value: 'cold', label: 'Cold' },
        ]}
      />

      <div className="mb-1.5 text-tiny text-dim2">Field</div>
      <SegmentedControl<FieldName>
        className="mb-3"
        value={s.viewField}
        onChange={(v) => s.set({ viewField: v })}
        options={[
          { value: 'temperature', label: 'T' },
          { value: 'velocity', label: 'U', disabled: s.contourSource === 'solved' && s.viewRegion === 'solid' },
          { value: 'pressure', label: 'p', disabled: s.contourSource === 'solved' && s.viewRegion === 'solid' },
        ]}
      />

      <SliderInput
        label="Clip plane"
        readout={(s.clip * 100).toFixed(0) + '%'}
        min={0}
        max={1}
        step={0.01}
        value={s.clip}
        showNumeric={false}
        onChange={(v) => s.set({ clip: v })}
        hint="Drag the yellow handle in the viewport, or the slider here."
      />
      <div className="mb-1.5 text-tiny text-dim2">Clip axis</div>
      <SegmentedControl<ClipAxis>
        className="mb-3"
        value={s.clipAxis}
        onChange={(v) => s.set({ clipAxis: v })}
        options={[
          { value: 'x', label: 'X' },
          { value: 'y', label: 'Y' },
          { value: 'z', label: 'Z' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {s.clipAxis === 'custom' ? (
        <div className="mb-3 flex items-center gap-1.5">
          {(['0', '1', '2'] as const).map((i, idx) => (
            <NumericInput
              key={i}
              align="right"
              className="w-full"
              step={0.1}
              value={s.clipNormal[idx]}
              onChange={(v) => {
                const next = [...s.clipNormal] as [number, number, number];
                next[idx] = v;
                s.set({ clipNormal: next });
              }}
            />
          ))}
        </div>
      ) : null}

      <SectionTitle className="mt-4">Performance — per unit cell</SectionTitle>
      <MetricRow divider large label="Δp hot" value={formatNumber(perf.hot.pressureDrop, 1)} unit="Pa" valueClassName="text-hot" />
      <MetricRow divider large label="Δp cold" value={formatNumber(perf.cold.pressureDrop, 1)} unit="Pa" valueClassName="text-cold" />
      <MetricRow divider large label="Heat duty Q" value={formatNumber(perf.Q, 2)} unit="W" valueClassName="text-ink" />
      <MetricRow divider large label="Overall U" value={formatNumber(perf.U, 0)} unit="W/m²K" valueClassName="text-ink" />
      <MetricRow divider large label="UA" value={formatNumber(perf.UA, 4)} unit="W/K" />
      <MetricRow divider large label="NTU" value={formatNumber(perf.NTU, 4)} unit="—" />
      <MetricRow divider large label="Effectiveness ε" value={(perf.effectiveness * 100).toFixed(2)} unit="%" valueClassName="text-accent" />
      <MetricRow divider large label="h hot / cold" value={perf.hot.h.toFixed(0) + ' / ' + perf.cold.h.toFixed(0)} unit="W/m²K" />
      <MetricRow label="Nu (hot)" value={perf.hot.nusselt.toFixed(2)} />
      <MetricRow label="f (hot)" value={perf.hot.friction.toFixed(5)} />
      <MetricRow label="Nu (cold)" value={perf.cold.nusselt.toFixed(2)} />
      <MetricRow label="f (cold)" value={perf.cold.friction.toFixed(5)} />
      <MetricRow divider large label="T out hot / cold" value={perf.ThOut.toFixed(2) + ' / ' + perf.TcOut.toFixed(2)} unit="°C" />

      <div
        className={cn(
          'my-3.5 rounded-md border p-2.5',
          balanceOk ? 'border-ok/25 bg-ok/[0.06]' : 'border-bad/35 bg-bad/[0.07]',
        )}
      >
        <div className="mb-1 flex justify-between">
          <span className={cn('text-smx font-semibold', balanceOk ? 'text-ok' : 'text-bad')}>
            Energy balance
          </span>
          <span className={cn('font-mono text-tiny', balanceOk ? 'text-ok' : 'text-bad')}>
            {perf.imbalance.toFixed(2)} %
          </span>
        </div>
        <div className="font-mono text-xxs leading-relaxed text-mute">
          Q hot {perf.Qhot.toFixed(3)} W · Q cold {perf.Qcold.toFixed(3)} W ·{' '}
          {balanceOk ? 'within 1% tolerance' : 'exceeds 1% tolerance'}
        </div>
      </div>

      <SectionTitle className="mt-4">Mesh independence</SectionTitle>
      {s.meshIndependence.results.length > 0 ? (
        <div className="rounded-md border border-line2 bg-card p-2.5 text-xxs leading-relaxed text-mute3">
          {s.meshIndependence.results.length} resolution(s) run — see the full table on the Mesh
          &amp; Solve step, or in the PDF report below.
        </div>
      ) : (
        <div className="rounded-md border border-line2 bg-card p-2.5 text-xxs leading-relaxed text-mute3">
          Not run yet. Reruns the full real meshing-and-solving pipeline at several resolutions
          — run it from the Mesh &amp; Solve step.
        </div>
      )}

      <div className="mt-4 flex gap-1.5">
        <ActionButton
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => {
            downloadText(s.caseName + '-report.json', JSON.stringify(report(), null, 2), 'application/json');
            s.flash('JSON report written');
          }}
        >
          JSON
        </ActionButton>
        <ActionButton
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => {
            downloadText(
              s.caseName + '-report.csv',
              toCSV(report() as unknown as Record<string, unknown>),
              'text/csv',
            );
            s.flash('CSV report written');
          }}
        >
          CSV
        </ActionButton>
        <ActionButton
          variant="primary"
          size="sm"
          className="flex-1"
          disabled={s.reportGenerating}
          onClick={async () => {
            s.set({ reportGenerating: true });
            try {
              const blob = await fetchReportPdf({
                caseName: s.caseName,
                surface: s.surface, cellX: s.cellX, cellY: s.cellY, cellZ: s.cellZ,
                thickness: s.thickness, grading: s.grading, gradAxis: s.gradAxis,
                nx: s.nx, ny: s.ny, nz: s.nz,
                faces: s.faces, hot: s.hot, cold: s.cold, solid: s.solid, flow: s.flow,
                mesh: s.mesh,
                residuals: s.residuals,
                iteration: s.iteration,
                converged: s.converged,
                meshIndependence: s.meshIndependence.results.length > 0 ? s.meshIndependence.results : null,
                meshIndependenceConvergence: s.meshIndependence.convergence?.rows ?? null,
                core: s.core,
                manufacturability: manufChecks,
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = s.caseName + '-report.pdf';
              a.click();
              URL.revokeObjectURL(url);
              s.flash('PDF report generated');
            } catch (err) {
              s.flash('PDF report failed — ' + (err instanceof Error ? err.message : 'not connected'));
            } finally {
              s.set({ reportGenerating: false });
            }
          }}
        >
          {s.reportGenerating ? 'Generating PDF…' : 'PDF report'}
        </ActionButton>
      </div>
      <div className="mt-2 text-xxs leading-relaxed text-mute3">
        The PDF is generated server-side from real geometry, mesh stats, and — if a solve has
        completed — genuine solved-field contours and boundary-derived performance. Can take up to
        a minute or two. JSON/CSV above stay instant, in-browser exports of the analytical model only.
      </div>
    </div>
  );
}
