import { useCallback, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { Check, Loader2, UploadCloud } from 'lucide-react';
import CardButton from '../ui/CardButton';
import SelectInput from '../ui/SelectInput';
import SliderInput from '../ui/SliderInput';
import Toggle from '../ui/Toggle';
import ActionButton from '../ui/ActionButton';
import MetricRow from '../ui/MetricRow';
import SectionTitle from '../ui/SectionTitle';
import { FACE_ROLES, SOLIDS } from '../../lib/presets';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';
import { usePhysics } from '../../hooks/usePhysics';
import { useTasks } from '../../hooks/useTasks';
import { useTransientFlag } from '../../hooks/useTransientFlag';
import { geometryCache } from '../../lib/geometryCache';
import { checkEscapeHoles, checkOverhang, checkWallThickness, computeOverhang, type CheckSeverity } from '../../lib/manufacturability';
import type { FaceKey, FaceRole, GeometryMode, RegionKey } from '../../lib/types';

const SEVERITY_CLASS: Record<CheckSeverity, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' };
const SEVERITY_LABEL: Record<CheckSeverity, string> = { ok: 'ok', warn: 'caution', bad: 'issue' };

const FACE_KEYS: FaceKey[] = ['X-', 'X+', 'Y-', 'Y+', 'Z-', 'Z+'];

const PALETTES: Record<RegionKey, string[]> = {
  hot: ['#e2603f', '#f2994a', '#c9384f', '#e6b800'],
  cold: ['#4aa8d8', '#3a7bd5', '#2ec4c6', '#6c7cf0'],
  solid: ['#c9ced4', '#9aa2ab', '#e8e4da', '#6b7480'],
};

const FLOW_EXPLANATION: Record<string, string> = {
  counter: 'Hot and cold inlets face opposite directions on the same axis – the streams run counter-current.',
  parallel: 'Hot and cold inlets face the same direction on the same axis – the streams run co-current.',
  cross: 'Hot and cold inlets sit on different axes – cross-flow.',
};

export default function RegionsPanel() {
  const s = useAppStore();
  const { performance: perf } = usePhysics();
  const { runFill, importPart } = useTasks();
  const [dragging, setDragging] = useState(false);
  const filling = s.busy?.label === 'Voxelising & booleaning lattice into wall region';
  const justValidated = useTransientFlag(Boolean(s.watertight?.ok) && !filling);

  const periodicCount = Object.values(s.faces).filter((r) => r.startsWith('periodic')).length;
  const inletCount = Object.values(s.faces).filter((r) => r.startsWith('inlet')).length;
  const outletCount = Object.values(s.faces).filter((r) => r.startsWith('outlet')).length;
  const facesOk = s.mode !== 'unitcell' || (periodicCount % 2 === 0 && periodicCount >= 2);

  const hotInletTagged = Object.values(s.faces).includes('inletHot');
  const coldInletTagged = Object.values(s.faces).includes('inletCold');

  // Recomputed from the actual generated solid geometry whenever it changes
  // (s.stats updates alongside geometryCache — see useLatticeGeometry.ts) —
  // not a static estimate.
  const overhang = useMemo(
    () => computeOverhang(geometryCache.positions, geometryCache.indices),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.stats.triangles, s.stats.ms],
  );
  const manufChecks = [checkWallThickness(s.thickness), ...checkEscapeHoles(s.faces), checkOverhang(overhang)];

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) importPart(file);
    },
    [importPart],
  );

  const regions: { key: RegionKey; label: string; meta: string }[] = [
    { key: 'hot', label: 'Hot fluid', meta: 'φ = ' + (perf.channelFraction * 100).toFixed(1) + ' %  ·  ' + s.hot.fluid },
    { key: 'cold', label: 'Cold fluid', meta: 'φ = ' + (perf.channelFraction * 100).toFixed(1) + ' %  ·  ' + s.cold.fluid },
    { key: 'solid', label: 'Solid wall', meta: 'φ = ' + (perf.solidFraction * 100).toFixed(1) + ' %  ·  ' + SOLIDS[s.solid.mat].label },
  ];

  return (
    <div className="px-4 pb-7 pt-4">
      <div className="mb-4 text-[14px] font-semibold">Geometry mode &amp; regions</div>

      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <CardButton
          title="Unit cell"
          subtitle="periodic · tractable"
          active={s.mode === 'unitcell'}
          onClick={() => s.set({ mode: 'unitcell' as GeometryMode })}
        />
        <CardButton
          title="Full assembly"
          subtitle="expensive · manifolds"
          active={s.mode === 'full'}
          onClick={() => s.set({ mode: 'full' as GeometryMode })}
        />
      </div>
      <div className="mb-4 text-xxs leading-relaxed text-mute3">
        {s.mode === 'unitcell'
          ? 'Recommended. Solves one repeating block with cyclic BCs, then scales analytically in phase 5.'
          : 'Imports a complete exchanger with real manifolds. Cell counts rise by 3–4 orders of magnitude; use for a validation build only.'}
      </div>

      {s.mode === 'full' && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'mb-4 rounded-md border border-dashed px-3.5 py-5 text-center transition-colors duration-120',
            dragging
              ? 'border-accent bg-accent/5'
              : s.imported
                ? 'border-ok/40'
                : 'border-white/15 hover:border-white/25',
          )}
        >
          <UploadCloud size={18} strokeWidth={1.6} className="mx-auto mb-1.5 text-mute2" />
          <div className="mb-1 text-base2 text-dim">{s.imported ? s.imported.name : 'Drop STEP / IGES / STL'}</div>
          <div className="font-mono text-xxs text-mute2">
            {s.imported
              ? s.imported.kind + ' · ' + s.imported.size + ' · parsed server-side'
              : 'no part loaded'}
          </div>
        </div>
      )}

      <SectionTitle>Regions – viewport shows all three together</SectionTitle>
      {regions.map((r) => (
        <div key={r.key} className="mb-2 rounded-md border border-line2 bg-card px-2.5 py-2">
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="h-[9px] w-[9px] rounded-[2px]" style={{ background: s.regionColor[r.key] }} />
            <span className="min-w-0 flex-1">
              <span className="block text-base2">{r.label}</span>
              <span className="block font-mono text-2xs text-mute2">{r.meta}</span>
            </span>
            <Toggle
              checked={s.regionVisibility[r.key]}
              onChange={(v) => s.set({ regionVisibility: { ...s.regionVisibility, [r.key]: v } })}
              label={r.label + ' visible'}
            />
          </div>
          <div className="mb-1.5 flex items-center gap-1.5">
            {PALETTES[r.key].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => s.set({ regionColor: { ...s.regionColor, [r.key]: c } })}
                className={cn(
                  'h-4 w-4 rounded-full border transition-transform duration-120',
                  s.regionColor[r.key] === c ? 'scale-110 border-ink' : 'border-white/20',
                )}
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
          <SliderInput
            label="Opacity"
            readout={(s.regionOpacity[r.key] * 100).toFixed(0) + '%'}
            min={0.05}
            max={1}
            step={0.05}
            value={s.regionOpacity[r.key]}
            showNumeric={false}
            onChange={(v) => s.set({ regionOpacity: { ...s.regionOpacity, [r.key]: v } })}
          />
        </div>
      ))}

      <SectionTitle className="mt-4">Boundary faces</SectionTitle>
      {FACE_KEYS.map((f) => (
        <div key={f} className="mb-1.5 flex items-center gap-2">
          <span className="w-[30px] font-mono text-tiny text-dim2">{f}</span>
          <SelectInput
            value={s.faces[f]}
            options={FACE_ROLES.map((r) => ({ value: r.value, label: r.label }))}
            onChange={(v) => s.setFace(f, v as FaceRole)}
            tone={s.faces[f].startsWith('periodic') ? 'accent' : 'default'}
          />
        </div>
      ))}
      <div className={cn('mt-2 text-xxs leading-relaxed', facesOk ? 'text-mute3' : 'text-bad')}>
        {facesOk
          ? periodicCount / 2 +
            ' periodic pair(s), ' +
            inletCount +
            ' inlet / ' +
            outletCount +
            ' outlet face(s) tagged.'
          : 'Periodic faces must be tagged in matching A/B pairs.'}
      </div>

      <SectionTitle className="mt-4">Flow configuration</SectionTitle>
      <div className="mb-2 flex items-center gap-2 rounded-md border border-line2 bg-card px-3 py-2.5">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: s.flow === 'counter' ? '#5ec8c0' : s.flow === 'parallel' ? '#e6b800' : '#c9384f' }}
        />
        <span className="text-base2 font-semibold capitalize">{s.flow} flow</span>
        <span className="ml-auto font-mono text-2xs text-mute2">
          {hotInletTagged && coldInletTagged ? 'auto-detected' : 'awaiting cold inlet tag'}
        </span>
      </div>
      <div className="mb-5 text-xxs leading-relaxed text-mute3">
        {hotInletTagged && coldInletTagged
          ? FLOW_EXPLANATION[s.flow]
          : 'Tag an inletCold face above – arrangement is derived from the hot and cold inlet faces, not chosen manually.'}
      </div>

      <div className="border-t border-line pt-4">
        <ActionButton variant="primary" size="block" className="mb-3" onClick={runFill} disabled={filling}>
          {filling ? (
            <Loader2 size={12} className="animate-spin" strokeWidth={2.2} />
          ) : justValidated ? (
            <Check size={12} strokeWidth={2.6} />
          ) : null}
          Fill wall &amp; validate watertightness
        </ActionButton>

        {s.watertight ? (
          <>
            <MetricRow
              label="Open edges"
              value={String(s.watertight.openEdges)}
              valueClassName={s.watertight.openEdges === 0 ? 'text-ok' : 'text-bad'}
            />
            <MetricRow
              label="Non-manifold edges"
              value={String(s.watertight.nonManifold)}
              valueClassName={s.watertight.nonManifold === 0 ? 'text-ok' : 'text-bad'}
            />
            <MetricRow label="Shells" value={String(s.watertight.shells)} />
            <MetricRow label="Wall volume" value={s.watertight.volume.toFixed(1) + ' mm³'} />
          </>
        ) : (
          <MetricRow label="Status" value="not validated" valueClassName="text-mute2" />
        )}

        <div className={cn('mt-2 text-xxs leading-relaxed', s.watertight && !s.watertight.ok ? 'text-bad' : 'text-mute3')}>
          {s.watertight
            ? s.watertight.ok
              ? 'Wall region sealed at domain boundaries; interior lattice verified manifold. Meshing unlocked.'
              : 'Fix geometry before meshing.'
            : 'Boolean intersection runs on a volumetric level-set representation, not triangle meshes.'}
        </div>
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <SectionTitle>Manufacturability (metal powder-bed printing)</SectionTitle>
        {manufChecks.map((c) => (
          <div key={c.label} className="mb-2">
            <MetricRow label={c.label} value={c.value} flag={SEVERITY_LABEL[c.severity]} flagClassName={SEVERITY_CLASS[c.severity]} valueClassName={SEVERITY_CLASS[c.severity]} />
            <div className="text-xxs leading-relaxed text-mute3">{c.detail}</div>
          </div>
        ))}
        <div className="mt-1 text-xxs leading-relaxed text-mute3">
          Wall thickness is a general design guideline, not a certified per-machine/material spec.
          The overhang figure is computed directly from the generated geometry above (build axis: the
          viewport's own "up" direction).
        </div>
      </div>
    </div>
  );
}
