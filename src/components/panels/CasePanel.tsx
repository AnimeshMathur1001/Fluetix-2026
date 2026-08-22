import { useMemo, useRef, useState } from 'react';
import { Copy, FolderOpen, Save, Tag } from 'lucide-react';
import NumericInput from '../ui/NumericInput';
import SearchableSelect, { type SearchableOption } from '../ui/SearchableSelect';
import ActionButton from '../ui/ActionButton';
import MetricRow from '../ui/MetricRow';
import SectionTitle from '../ui/SectionTitle';
import RecommendationsCard from '../ui/RecommendationsCard';
import { FLUIDS, SOLIDS } from '../../lib/presets';
import { CORRELATION_NOTE, isCorrelated } from '../../lib/fluidProperties';
import { SOLID_PROPERTY_NOTE } from '../../lib/solidProperties';
import { flowRecommendation, solidConductivityNote } from '../../lib/recommendations';
import { useAppStore } from '../../store/useAppStore';
import { usePhysics } from '../../hooks/usePhysics';
import type { Stream } from '../../lib/types';

interface FieldSpec {
  label: string;
  key: keyof Stream;
  unit: string;
  step: number;
}

const STREAM_FIELDS: FieldSpec[] = [
  { label: 'Density ρ', key: 'rho', unit: 'kg/m³', step: 1 },
  { label: 'Viscosity μ', key: 'mu', unit: 'Pa·s', step: 1e-5 },
  { label: 'Specific heat cₚ', key: 'cp', unit: 'J/kg·K', step: 10 },
  { label: 'Conductivity k', key: 'k', unit: 'W/m·K', step: 0.01 },
  { label: 'Mass flow ṁ', key: 'mdot', unit: 'kg/s', step: 0.001 },
  { label: 'Outlet pressure', key: 'pOut', unit: 'Pa gauge', step: 100 },
];

const BUILTIN_FLUID_OPTIONS: SearchableOption[] = Object.entries(FLUIDS).map(([k, v]) => ({ value: k, label: v.label }));
// Already covered by the friendly built-in presets above (with real CoolProp physics
// behind them via the legacy-alias resolution server-side) — skip the plain duplicates
// from the full catalog so the list doesn't show "Water" and "Water" twice.
const CATALOG_DUPES = new Set(['water', 'air', 'hydrogen']);

/** Small inline "save current values as a named material" affordance, shared by
 *  the fluid and solid cards below. */
function SaveAsMaterial({ onSave }: { onSave: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-2.5 flex items-center gap-1.5 text-2xs text-mute2 transition-colors duration-120 hover:text-accent"
      >
        <Tag size={10} strokeWidth={1.8} />
        Save current values as a custom material
      </button>
    );
  }
  return (
    <div className="mb-2.5 flex items-center gap-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            onSave(name);
            setOpen(false);
            setName('');
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder="Name this material…"
        className="min-w-0 flex-1 rounded border border-line2 bg-field px-2 py-1 text-tiny text-ink outline-none focus:border-accent/60"
      />
      <ActionButton
        size="sm"
        variant="primary"
        disabled={!name.trim()}
        onClick={() => {
          if (!name.trim()) return;
          onSave(name);
          setOpen(false);
          setName('');
        }}
      >
        Save
      </ActionButton>
      <ActionButton size="sm" onClick={() => setOpen(false)}>
        Cancel
      </ActionButton>
    </div>
  );
}

function StreamCard({ which }: { which: 'hot' | 'cold' }) {
  const stream = useAppStore((s) => s[which]);
  const faces = useAppStore((s) => s.faces);
  const setStream = useAppStore((s) => s.setStream);
  const setStreamTemperature = useAppStore((s) => s.setStreamTemperature);
  const applyFluidPreset = useAppStore((s) => s.applyFluidPreset);
  const favorites = useAppStore((s) => s.materialFavorites);
  const recents = useAppStore((s) => s.materialRecents);
  const toggleMaterialFavorite = useAppStore((s) => s.toggleMaterialFavorite);
  const fluidCatalog = useAppStore((s) => s.fluidCatalog);
  const customFluids = useAppStore((s) => s.customFluids);
  const saveCustomFluid = useAppStore((s) => s.saveCustomFluid);
  const deleteCustomFluid = useAppStore((s) => s.deleteCustomFluid);

  const tagged = Object.entries(faces)
    .filter(([, role]) => role.toLowerCase().includes(which))
    .map(([face]) => face)
    .join(' ');

  // Every fluid except "custom" (manual override) and a user's own saved snapshot
  // gets recomputed automatically — the 5 legacy keys via a client-side correlation
  // AND the backend, the other ~130 CoolProp fluids via the backend only.
  const auto = stream.fluid !== 'custom' && !customFluids[stream.fluid];
  const auto_isLegacy = isCorrelated(stream.fluid);

  const fluidOptions = useMemo<SearchableOption[]>(() => {
    const catalog = fluidCatalog
      .filter((f) => !CATALOG_DUPES.has(f.key.toLowerCase()))
      .map((f) => ({ value: f.key, label: f.label }));
    const custom = Object.entries(customFluids).map(([k, v]) => ({ value: k, label: v.label, custom: true }));
    return [...custom, ...BUILTIN_FLUID_OPTIONS, ...catalog];
  }, [fluidCatalog, customFluids]);

  return (
    <div className="mb-3 rounded-md border border-line2 bg-card p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-[2px]"
          style={{ background: which === 'hot' ? '#e2603f' : '#4aa8d8' }}
        />
        <span className="whitespace-nowrap text-med font-semibold">
          {which === 'hot' ? 'Hot stream' : 'Cold stream'}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-2xs text-mute2">{tagged || '—'}</span>
      </div>

      <SearchableSelect
        className="mb-2.5"
        value={stream.fluid}
        options={fluidOptions}
        favorites={favorites}
        recents={recents}
        onChange={(v) => applyFluidPreset(which, v)}
        onToggleFavorite={toggleMaterialFavorite}
        onDelete={deleteCustomFluid}
      />

      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex-1 whitespace-nowrap text-tiny text-dim2">Inlet temperature</span>
        <NumericInput
          align="right"
          className="w-[78px]"
          step={1}
          value={stream.Tin}
          onChange={(v) => setStreamTemperature(which, v)}
        />
        <span className="w-[52px] font-mono text-2xs text-mute3">°C</span>
      </div>

      {STREAM_FIELDS.map((f) => (
        <div key={f.key} className="mb-1.5 flex items-center gap-2">
          <span className="flex-1 whitespace-nowrap text-tiny text-dim2">{f.label}</span>
          <NumericInput
            align="right"
            className="w-[78px]"
            step={f.step}
            value={stream[f.key] as number}
            onChange={(v) => setStream(which, { [f.key]: v } as Partial<Stream>)}
          />
          <span className="w-[52px] font-mono text-2xs text-mute3">{f.unit}</span>
        </div>
      ))}
      {auto ? (
        <div className="mb-2 mt-1.5 text-xxs leading-relaxed text-mute3">
          ρ/μ/cₚ/k recomputed automatically from inlet temperature and outlet pressure
          {auto_isLegacy
            ? ' (instant local estimate, upgraded to a verified value once connected).'
            : ' via the connected physical-property database — needs a live connection.'}
        </div>
      ) : null}
      <SaveAsMaterial onSave={(name) => saveCustomFluid(which, name)} />
    </div>
  );
}

export default function CasePanel() {
  const s = useAppStore();
  const { performance: perf } = usePhysics();
  const periodicCount = Object.values(s.faces).filter((r) => r.startsWith('periodic')).length;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const solidOptions = useMemo<SearchableOption[]>(() => {
    const custom = Object.entries(s.customSolids).map(([k, v]) => ({ value: k, label: v.label, custom: true }));
    const builtin = Object.entries(SOLIDS).map(([k, v]) => ({ value: k, label: v.label }));
    return [...custom, ...builtin];
  }, [s.customSolids]);

  const recommendations = [
    flowRecommendation({
      which: 'hot',
      mdot: s.hot.mdot,
      reynolds: perf.hot.reynolds,
      applyMdot: (v) => s.setStream('hot', { mdot: v }),
    }),
    flowRecommendation({
      which: 'cold',
      mdot: s.cold.mdot,
      reynolds: perf.cold.reynolds,
      applyMdot: (v) => s.setStream('cold', { mdot: v }),
    }),
  ];
  const materialNote = solidConductivityNote(s.solid.k, s.thickness);

  return (
    <div className="px-4 pb-7 pt-4">
      <div className="mb-4 text-[14px] font-semibold">Materials &amp; boundary conditions</div>

      <RecommendationsCard items={recommendations} note={materialNote} />

      <StreamCard which="hot" />
      <StreamCard which="cold" />
      <div className="mb-4 text-xxs leading-relaxed text-mute3">{CORRELATION_NOTE}</div>

      <div className="mb-3 rounded-md border border-line2 bg-card p-3">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="h-2 w-2 rounded-[2px] bg-dim2" />
          <span className="whitespace-nowrap text-med font-semibold">Solid — lattice wall</span>
        </div>
        <SearchableSelect
          className="mb-2.5"
          value={s.solid.mat}
          options={solidOptions}
          favorites={s.materialFavorites}
          recents={s.materialRecents}
          onChange={(v) => s.applySolidPreset(v)}
          onToggleFavorite={s.toggleMaterialFavorite}
          onDelete={s.deleteCustomSolid}
        />
        <div className="mb-1.5 flex items-center gap-2">
          <span className="flex-1 whitespace-nowrap text-tiny text-dim2">Reference temperature</span>
          <NumericInput
            align="right"
            className="w-[78px]"
            step={5}
            value={s.solidRefTempC}
            onChange={(v) => s.setSolidRefTemp(v)}
          />
          <span className="w-[52px] font-mono text-2xs text-mute3">°C</span>
        </div>
        {([
          { label: 'Conductivity k', key: 'k', unit: 'W/m·K', step: 1 },
          { label: 'Density ρ', key: 'rho', unit: 'kg/m³', step: 10 },
          { label: 'Specific heat cₚ', key: 'cp', unit: 'J/kg·K', step: 10 },
        ] as const).map((f) => (
          <div key={f.key} className="mb-1.5 flex items-center gap-2">
            <span className="flex-1 whitespace-nowrap text-tiny text-dim2">{f.label}</span>
            <NumericInput
              align="right"
              className="w-[78px]"
              step={f.step}
              value={s.solid[f.key]}
              onChange={(v) => s.set({ solid: { ...s.solid, [f.key]: v }, converged: null })}
            />
            <span className="w-[52px] font-mono text-2xs text-mute3">{f.unit}</span>
          </div>
        ))}
        <div className="mb-2 mt-1.5 text-xxs leading-relaxed text-mute3">
          k/cₚ recomputed automatically from the reference temperature for the 5 built-in alloys.{' '}
          {SOLID_PROPERTY_NOTE}
        </div>
        <SaveAsMaterial onSave={(name) => s.saveCustomSolid(name)} />
      </div>

      <SectionTitle>Nusselt Correction</SectionTitle>
      <div className="mb-2 text-xxs leading-relaxed text-mute3">
        Applied in the laminar branch as Nu = 4.36 x A x Re^b. Adjust A and b to match your
        surface geometry and fluid pair.
      </div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex-1 whitespace-nowrap text-tiny text-dim2">Coefficient A</span>
        <NumericInput
          align="right"
          className="w-[78px]"
          step={0.001}
          min={0.001}
          max={10}
          value={s.nuCorrection.A}
          onChange={(v) => s.setNuCorrection({ ...s.nuCorrection, A: v })}
        />
      </div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex-1 whitespace-nowrap text-tiny text-dim2">Exponent b</span>
        <NumericInput
          align="right"
          className="w-[78px]"
          step={0.01}
          min={0.05}
          max={2.0}
          value={s.nuCorrection.b}
          onChange={(v) => s.setNuCorrection({ ...s.nuCorrection, b: v })}
        />
      </div>
      <div className="mb-3.5">
        <div className="mb-1.5 text-tiny text-dim2">Source note (recorded in report)</div>
        <input
          value={s.nuCorrection.sourceNote}
          onChange={(e) => s.setNuCorrection({ ...s.nuCorrection, sourceNote: e.target.value })}
          placeholder="e.g. Calibrated against own CFD, Re 400-1200"
          className="w-full rounded border border-line2 bg-field px-2 py-1 text-tiny text-ink outline-none focus:border-accent/60"
        />
      </div>

      <div className="mb-3.5 rounded-md border border-line2 bg-card p-3">
        <div className="mb-2 text-base2 font-semibold">Periodic BCs</div>
        <MetricRow
          label="Cyclic patches"
          value={periodicCount / 2 + ' pair(s)'}
          valueClassName={periodicCount % 2 === 0 && periodicCount >= 2 ? 'text-ok' : 'text-bad'}
        />
        <MetricRow label="Type" value="cyclicAMI · rotational off" />
        <MetricRow label="Streamwise driver" value="fixed ṁ + source" />
        <div className="mt-1.5 text-xxs leading-relaxed text-mute3">
          {s.mode === 'unitcell'
            ? 'Cyclic patches make the block behave as an infinite repeating lattice.'
            : 'Full-assembly mode — no cyclic patches applied.'}
        </div>
      </div>

      <div className="flex gap-2">
        <ActionButton variant="primary" size="block" onClick={s.exportProjectFile}>
          <Save size={12} strokeWidth={1.9} />
          Save case
        </ActionButton>
        <ActionButton className="whitespace-nowrap" onClick={() => fileInputRef.current?.click()}>
          <FolderOpen size={12} strokeWidth={1.9} />
          Load
        </ActionButton>
        <ActionButton className="whitespace-nowrap" onClick={s.duplicateCase}>
          <Copy size={12} strokeWidth={1.9} />
          Duplicate
        </ActionButton>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) s.importProjectFile(file);
          e.target.value = '';
        }}
      />
      <div className="mt-2 text-xxs leading-relaxed text-mute3">
        Saves geometry, regions, materials and solver settings to a JSON file on disk. Mesh &amp; solve
        results aren&apos;t included — re-run them after loading.
      </div>
    </div>
  );
}
