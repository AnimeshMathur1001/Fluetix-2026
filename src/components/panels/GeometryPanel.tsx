import { Download, Loader2, Square } from 'lucide-react';
import SurfaceSelector from './SurfaceSelector';
import SliderInput from '../ui/SliderInput';
import SegmentedControl from '../ui/SegmentedControl';
import SelectInput from '../ui/SelectInput';
import ActionButton from '../ui/ActionButton';
import MetricRow from '../ui/MetricRow';
import SectionTitle from '../ui/SectionTitle';
import { useAppStore } from '../../store/useAppStore';
import { usePhysics } from '../../hooks/usePhysics';
import { useTasks } from '../../hooks/useTasks';
import { buildStepFile, downloadText, exportOBJ, exportSTL } from '../../lib/exporters';
import { geometryCache } from '../../lib/geometryCache';
import {
  adaptiveVoxelsPerCell,
  estimateMemoryMB,
  estimateTriangles,
  VOXELS_FULL,
  VOXELS_PREVIEW,
  type LatticeParams,
} from '../../lib/tpms';
import { formatInt } from '../../lib/utils';
import type { Axis, ExportFormat, Quality } from '../../lib/types';

export default function GeometryPanel() {
  const s = useAppStore();
  const { performance: perf } = usePhysics();
  const { runGenerate, cancelGenerate } = useTasks();

  const gradingHint =
    s.grading === 0
      ? 'Uniform'
      : 'Thickness varies ' +
        (s.grading > 0 ? '+' : '') +
        (s.grading * 100).toFixed(0) +
        '% along ' +
        s.gradAxis.toUpperCase();

  const draft: LatticeParams = {
    surface: s.surface,
    cellX: s.cellX,
    cellY: s.cellY,
    cellZ: s.cellZ,
    thickness: s.thickness,
    grading: s.grading,
    gradAxis: s.gradAxis,
    nx: s.nx,
    ny: s.ny,
    nz: s.nz,
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(s.activeParams);
  const baseVoxels = s.quality === 'full' ? VOXELS_FULL : VOXELS_PREVIEW;
  const nextVoxels = adaptiveVoxelsPerCell(draft.nx, draft.ny, draft.nz, baseVoxels);
  const estTri = estimateTriangles(draft, nextVoxels);
  const estMem = estimateMemoryMB(estTri);
  const estSeconds = Math.max(0.3, Math.min(3, estTri / 3500)).toFixed(1);
  const downscaled = nextVoxels < baseVoxels;

  const handleExport = () => {
    if (s.exportFormat === 'step') {
      s.set({
        busy: { label: 'Tessellating to STEP AP214', percent: 60, detail: 'writing AP214' },
      });
      window.setTimeout(() => {
        downloadText(
          s.caseName + '.step',
          buildStepFile({
            caseName: s.caseName,
            surface: s.surface,
            cell: [s.cellX, s.cellY, s.cellZ],
            thickness: s.thickness,
            triangles: s.stats.triangles,
            vertices: s.stats.vertices,
          }),
          'application/step',
        );
        s.set({ busy: null });
        s.flash('STEP written – faceted B-Rep, ' + formatInt(s.stats.triangles) + ' faces');
      }, 900);
      return;
    }
    if (s.exportFormat === 'obj') {
      const n = exportOBJ(s.caseName + '.obj', geometryCache.positions, geometryCache.indices);
      s.flash('OBJ written – ' + formatInt(n) + ' triangles');
      return;
    }
    const n = exportSTL(s.caseName + '.stl', geometryCache.positions, geometryCache.indices);
    s.flash('STL written – ' + formatInt(n) + ' triangles');
  };

  return (
    <div className="px-4 pb-7 pt-4">
      <div className="mb-4 text-[14px] font-semibold">TPMS lattice</div>

      <div className="mb-1.5 text-tiny text-dim2">Surface</div>
      <SurfaceSelector />

      <SliderInput label="Unit cell X" unit="mm" min={3} max={25} step={0.5} value={s.cellX} onChange={(v) => s.setLattice({ cellX: v })} />
      <SliderInput label="Unit cell Y" unit="mm" min={3} max={25} step={0.5} value={s.cellY} onChange={(v) => s.setLattice({ cellY: v })} />
      <SliderInput label="Unit cell Z" unit="mm" min={3} max={25} step={0.5} value={s.cellZ} onChange={(v) => s.setLattice({ cellZ: v })} hint="Flow direction" />
      <SliderInput label="Wall thickness" unit="mm" min={0.2} max={3} step={0.05} value={s.thickness} onChange={(v) => s.setLattice({ thickness: v })} hint="Isosurface offset – |f| < c" />
      <SliderInput label="Thickness gradient" unit="−1 … 1" min={-0.8} max={0.8} step={0.05} value={s.grading} onChange={(v) => s.setLattice({ grading: v })} hint={gradingHint} />
      <SliderInput label="Cells X" unit="–" min={1} max={10} step={1} value={s.nx} onChange={(v) => s.setLattice({ nx: v })} />
      <SliderInput label="Cells Y" unit="–" min={1} max={10} step={1} value={s.ny} onChange={(v) => s.setLattice({ ny: v })} />
      <SliderInput label="Cells Z" unit="–" min={1} max={10} step={1} value={s.nz} onChange={(v) => s.setLattice({ nz: v })} hint={'Total ' + s.nx * s.ny * s.nz + ' unit cells'} />

      <div className="mb-3 mt-4">
        <div className="mb-1.5 text-smx text-dim">Grading axis</div>
        <SegmentedControl<Axis>
          value={s.gradAxis}
          onChange={(v) => s.setLattice({ gradAxis: v })}
          options={[
            { value: 'x', label: 'X' },
            { value: 'y', label: 'Y' },
            { value: 'z', label: 'Z' },
          ]}
        />
      </div>

      <div className="mb-1.5 mt-4 flex gap-2">
        <SegmentedControl<Quality>
          value={s.quality}
          onChange={(v) => s.set({ quality: v })}
          options={[
            { value: 'preview', label: 'Preview res.' },
            { value: 'full', label: 'Full res.' },
          ]}
          className="flex-1"
        />
      </div>
      <div className="mb-4 text-xxs leading-relaxed text-mute3">
        Preview is {VOXELS_PREVIEW}³ voxels/cell, full is {VOXELS_FULL}³. Nothing regenerates until you
        click Generate – sliders only edit the draft below.
      </div>

      <div className="mb-4 rounded-md border border-line2 bg-card p-3">
        <MetricRow
          label="Est. triangles"
          value={formatInt(estTri)}
          valueClassName={dirty ? 'text-warn' : 'text-mute2'}
        />
        <MetricRow label="Est. memory" value={estMem.toFixed(1) + ' MB'} />
        <MetricRow label="Est. time" value={estSeconds + ' s'} />
        {downscaled ? (
          <div className="mt-1 text-xxs leading-relaxed text-warn">
            {nextVoxels}³/cell – auto-downscaled from {baseVoxels}³ to stay interactive at{' '}
            {draft.nx * draft.ny * draft.nz} cells.
          </div>
        ) : null}
        <div className="mt-2.5 flex gap-2">
          <ActionButton variant="primary" size="block" onClick={runGenerate} disabled={s.generating}>
            {s.generating ? <Loader2 size={12} className="animate-spin" strokeWidth={2.2} /> : null}
            {s.generating ? 'Generating…' : dirty ? 'Generate geometry' : 'Regenerate'}
          </ActionButton>
          {s.generating ? (
            <ActionButton onClick={cancelGenerate} className="whitespace-nowrap">
              <Square size={11} strokeWidth={2} />
              Cancel
            </ActionButton>
          ) : null}
        </div>
        <div className={'mt-2 text-xxs leading-relaxed ' + (dirty ? 'text-warn' : 'text-ok')}>
          {dirty ? 'Parameters changed – viewport shows the last generated geometry.' : 'Viewport is up to date.'}
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <SectionTitle>Export – lattice wall</SectionTitle>
        <MetricRow label="Triangles" value={formatInt(s.stats.triangles)} />
        <MetricRow label="Solid fraction φ" value={(s.stats.solidFraction * 100).toFixed(1) + ' %'} />
        <MetricRow label="Specific area" value={s.stats.specificArea.toFixed(0) + ' m²/m³'} />
        <MetricRow label="Hydraulic diameter" value={(perf.hydraulicDiameter * 1000).toFixed(2) + ' mm'} />
        <MetricRow
          label="Watertight"
          value={s.watertight ? (s.watertight.ok ? 'pass · 0 open edges' : 'FAIL') : 'not checked'}
          valueClassName={s.watertight ? (s.watertight.ok ? 'text-ok' : 'text-bad') : 'text-mute2'}
        />

        <div className="mt-3 flex gap-2">
          <SelectInput
            value={s.exportFormat}
            onChange={(v) => s.set({ exportFormat: v as ExportFormat })}
            options={[
              { value: 'stl', label: 'STL (binary)' },
              { value: 'obj', label: 'OBJ (text)' },
              { value: 'step', label: 'STEP AP214 (tessellated)' },
            ]}
          />
          <ActionButton variant="outline" size="sm" className="whitespace-nowrap" onClick={handleExport}>
            <Download size={12} strokeWidth={1.8} />
            Export
          </ActionButton>
        </div>
        <div className="mt-2 text-xxs leading-relaxed text-mute3">
          STL/OBJ are the primary formats – both import cleanly everywhere. STEP is written as a
          best-effort tessellated B-Rep: TPMS surfaces are not NURBS-representable, so faceting is
          expected, and some CAD packages may still be picky about it. No .sldprt export.
        </div>
      </div>
    </div>
  );
}
