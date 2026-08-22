import NumericInput from '../ui/NumericInput';
import ActionButton from '../ui/ActionButton';
import MetricRow from '../ui/MetricRow';
import SectionTitle from '../ui/SectionTitle';
import { useAppStore } from '../../store/useAppStore';
import { usePhysics } from '../../hooks/usePhysics';
import { useTasks } from '../../hooks/useTasks';
import { buildReport } from '../../lib/report';
import { downloadText } from '../../lib/exporters';
import { formatInt } from '../../lib/utils';
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
  const { runValidation, runBlockCheck } = useTasks();

  return (
    <div className="px-4 pb-7 pt-4">
      <div className="mb-4 text-[14px] font-semibold">Scale-up &amp; validation</div>

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
      <MetricRow divider large label="NTU" value={sc.NTU.toFixed(3)} unit="—" />
      <MetricRow divider large label="Effectiveness ε" value={(sc.effectiveness * 100).toFixed(2)} unit="%" valueClassName="text-accent" />
      <MetricRow divider large label="T out hot / cold" value={sc.ThOut.toFixed(1) + ' / ' + sc.TcOut.toFixed(1)} unit="°C" />
      <MetricRow divider large label="Pumping power" value={sc.pumpingPower.toFixed(1)} unit="W" />
      <MetricRow divider large label="Power density" value={sc.powerDensity.toFixed(2)} unit="kW/L" />

      <div className="my-4 border-l-2 border-accent/50 py-0.5 pl-3 text-smx leading-relaxed text-dim2">
        Full-scale numbers assume the simulated unit cell repeats identically across {sc.parallel}{' '}
        parallel and {sc.series} series positions. Entrance effects, manifold maldistribution and header
        pressure losses are excluded. Δp scales with series count; UA scales with total cell count; ε is
        recomputed from total NTU, not multiplied.
      </div>

      <div className="border-t border-line pt-4">
        <SectionTitle>Validation</SectionTitle>
        <ActionButton size="block" className="mb-2.5" onClick={runValidation}>
          Run reference case — straight duct
        </ActionButton>
        {s.validation ? (
          <>
            <MetricRow label="Nu — simulated" value={s.validation.nuSim.toFixed(3)} />
            <MetricRow label="Nu — correlation" value={s.validation.nuRef.toFixed(3)} />
            <MetricRow
              label="Nu error"
              value={
                (s.validation.nuSim > s.validation.nuRef ? '+' : '') +
                (((s.validation.nuSim - s.validation.nuRef) / s.validation.nuRef) * 100).toFixed(2) +
                ' %'
              }
              valueClassName={
                Math.abs((s.validation.nuSim - s.validation.nuRef) / s.validation.nuRef) < 0.05
                  ? 'text-ok'
                  : 'text-bad'
              }
            />
            <MetricRow
              label="f·Re error"
              value={
                (s.validation.frSim > s.validation.frRef ? '+' : '') +
                (((s.validation.frSim - s.validation.frRef) / s.validation.frRef) * 100).toFixed(2) +
                ' %'
              }
              valueClassName={
                Math.abs((s.validation.frSim - s.validation.frRef) / s.validation.frRef) < 0.05
                  ? 'text-ok'
                  : 'text-bad'
              }
            />
          </>
        ) : (
          <MetricRow label="Status" value="not run" valueClassName="text-mute2" />
        )}

        <ActionButton size="block" className="mb-2.5 mt-3" onClick={runBlockCheck}>
          Periodicity check — 3×3×3 block
        </ActionButton>
        {s.blockCheck ? (
          <>
            <MetricRow label="Block cells" value={formatInt(s.blockCheck.cells) + ' k'} />
            <MetricRow
              label="Δ Q per cell"
              value={s.blockCheck.deltaQ.toFixed(2) + ' %'}
              valueClassName={s.blockCheck.deltaQ < 5 ? 'text-ok' : 'text-warn'}
            />
            <MetricRow
              label="Δ Δp per cell"
              value={s.blockCheck.deltaP.toFixed(2) + ' %'}
              valueClassName={s.blockCheck.deltaP < 5 ? 'text-ok' : 'text-warn'}
            />
          </>
        ) : (
          <MetricRow label="Status" value="not run" valueClassName="text-mute2" />
        )}

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
