import NumericInput from '../ui/NumericInput';
import ActionButton from '../ui/ActionButton';
import MetricRow from '../ui/MetricRow';
import SectionTitle from '../ui/SectionTitle';
import { useAppStore } from '../../store/useAppStore';
import { usePhysics } from '../../hooks/usePhysics';
import { buildReport } from '../../lib/report';
import { downloadText } from '../../lib/exporters';
import { formatInt, toDisplayTemp, tempUnitLabel } from '../../lib/utils';
import type { CoreTarget } from '../../lib/types';

const CORE_FIELDS: { label: string; key: keyof CoreTarget; unit: string; step: number }[] = [
  { label: 'Core width', key: 'width', unit: 'mm', step: 10 },
  { label: 'Core height', key: 'height', unit: 'mm', step: 10 },
  { label: 'Core length', key: 'length', unit: 'mm', step: 10 },
  { label: 'Total ṁ hot', key: 'mdotHot', unit: 'kg/s', step: 0.05 },
  { label: 'Total ṁ cold', key: 'mdotCold', unit: 'kg/s', step: 0.05 },
];

export default function ScaleUpPanel() {
  const s = useAppStore();
  const { performance: perf, scaleUp: sc, effectiveTurbulence } = usePhysics();

  return (
    <div className="px-4 pb-7 pt-4">
      <div className="mb-4 text-[14px] font-semibold">Scale-up</div>

      <SectionTitle>Target core</SectionTitle>
      {CORE_FIELDS.map((f) => (
        <div key={f.key} className="mb-1.5 flex items-center gap-2">
          <span className="flex-1 whitespace-nowrap text-smx text-dim">{f.label}</span>
          <NumericInput
            align="right"
            className="w-[82px]"
            step={f.step}
            value={s.core[f.key]}
            onChange={(v) => s.set({ core: { ...s.core, [f.key]: v } })}
          />
          <span className="w-11 font-mono text-2xs text-mute3">{f.unit}</span>
        </div>
      ))}

      <div className="my-3 rounded-md border border-line2 bg-card p-2.5">
        <MetricRow label="Parallel" value={sc.parallelX + ' × ' + sc.parallelY + ' = ' + sc.parallel} />
        <MetricRow label="Series" value={String(sc.series)} />
        <MetricRow label="Total cells" value={formatInt(sc.totalCells)} />
        <MetricRow label="HT area" value={sc.area.toFixed(2) + ' m²'} />
        <MetricRow label="Core volume" value={(sc.coreVolume * 1000).toFixed(2) + ' L'} />
      </div>

      <SectionTitle className="mt-4">Full-scale estimate</SectionTitle>
      <MetricRow divider large label="Δp hot" value={(sc.pressureDropHot / 1000).toFixed(2)} unit="kPa" valueClassName="text-hot" />
      <MetricRow divider large label="Δp cold" value={(sc.pressureDropCold / 1000).toFixed(2)} unit="kPa" valueClassName="text-cold" />
      <MetricRow divider large label="Heat duty Q" value={(sc.Q / 1000).toFixed(2)} unit="kW" valueClassName="text-ink" />
      <MetricRow divider large label="Overall U" value={sc.U.toFixed(0)} unit="W/m²K" valueClassName="text-ink" />
      <MetricRow divider large label="UA" value={sc.UA.toFixed(1)} unit="W/K" />
      <MetricRow divider large label="NTU" value={sc.NTU.toFixed(3)} unit="–" />
      <MetricRow divider large label="Effectiveness ε" value={(sc.effectiveness * 100).toFixed(2)} unit="%" valueClassName="text-accent" />
      <MetricRow
        divider
        large
        label="T out hot / cold"
        value={toDisplayTemp(sc.ThOut, s.tempUnit).toFixed(1) + ' / ' + toDisplayTemp(sc.TcOut, s.tempUnit).toFixed(1)}
        unit={tempUnitLabel(s.tempUnit)}
      />
      <MetricRow divider large label="Pumping power" value={sc.pumpingPower.toFixed(1)} unit="W" />
      <MetricRow divider large label="Power density" value={sc.powerDensity.toFixed(2)} unit="kW/L" />

      <div className="my-4 border-l-2 border-accent/50 py-0.5 pl-3 text-smx leading-relaxed text-dim2">
        Full-scale numbers assume the simulated unit cell repeats identically across {sc.parallel}{' '}
        parallel and {sc.series} series positions. Entrance effects, manifold maldistribution and header
        pressure losses are excluded. Δp scales with series count; UA scales with total cell count; ε is
        recomputed from total NTU, not multiplied.
      </div>

      {/* A real reference-case validation (mesh a straight duct, solve it, compare
          Nu/f·Re to Shah & London) and a real periodicity/block-independence check
          (solve a 3×3×3 block, compare per-cell averages to 1×1×1) both used to live
          here, but neither ever ran real physics — they showed Math.random()-jittered
          or hardcoded-zero numbers as if they were measured results. Removed rather
          than fixed in place: building the real versions is future work, not a patch. */}
      <div className="border-t border-line pt-4">
        <ActionButton
          variant="outline"
          size="block"
          className="mt-3.5"
          onClick={() => {
            const report = buildReport(s, perf, sc, effectiveTurbulence);
            downloadText(
              s.caseName + '-scaleup.json',
              JSON.stringify(report.scale_up, null, 2),
              'application/json',
            );
            s.flash('Scale-up summary written');
          }}
        >
          Export scale-up summary (JSON)
        </ActionButton>
      </div>
    </div>
  );
}
