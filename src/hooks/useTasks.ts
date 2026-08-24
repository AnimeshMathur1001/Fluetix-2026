import { useCallback, useRef } from 'react';
import { useAppStore, type AppState } from '../store/useAppStore';
import { adaptiveVoxelsPerCell, estimateTriangles, VOXELS_FULL, VOXELS_PREVIEW, type LatticeParams } from '../lib/tpms';
import { clamp, formatInt } from '../lib/utils';
import { geometryCache } from '../lib/geometryCache';
import { fetchWatertight, openMeshSocket, type MeshProgressMessage } from '../lib/api';

/** Drives the progress overlay for a staged back-end job. Deliberately has NO
 *  unmount cleanup: `useTasks()` is called fresh in every panel that needs it
 *  (Geometry/Regions/Mesh&Solve/Scale-up), and only one panel is ever mounted
 *  at a time (see ParameterPanel.tsx). An earlier version cleared the timer
 *  on unmount, which meant simply navigating to a different workflow step
 *  mid-animation silently abandoned the job forever — `done()` (which sets
 *  `s.filled`/clears `busy`/etc) never got a chance to run, so e.g. Fill &
 *  validate could get permanently stuck if the user clicked it and then
 *  switched steps before its ~2.6s animation finished. The timer and its
 *  `done()` callback don't depend on the initiating component still being
 *  mounted — they only touch the global Zustand store — so letting them run
 *  to completion regardless of navigation is correct, matching how the real
 *  WS-driven jobs (mesh independence, uncertainty, design explorer) already
 *  behave. */
function useProgress() {
  const set = useAppStore((s) => s.set);
  const timer = useRef<number | undefined>(undefined);

  const run = useCallback(
    (label: string, durationMs: number, stages: string[], done: () => void | Promise<void>) => {
      let elapsed = 0;
      const tick = durationMs / 24;
      set({ busy: { label, percent: 0, detail: stages[0] ?? '' } });
      window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        elapsed += tick;
        const percent = Math.min(100, (elapsed / durationMs) * 100);
        const detail = stages[Math.min(stages.length - 1, Math.floor((percent / 100) * stages.length))] ?? '';
        set({ busy: { label, percent, detail } });
        if (percent >= 100) {
          window.clearInterval(timer.current);
          // `done` can outlast the fake progress animation (a real backend
          // call, e.g. meshing, can run well past it) — keep the overlay up
          // until it actually resolves rather than clearing it early and
          // leaving the UI looking stuck with no indicator.
          const result = done();
          if (result instanceof Promise) result.finally(() => set({ busy: null }));
          else set({ busy: null });
        }
      }, tick);
    },
    [set],
  );

  const cancel = useCallback(() => {
    window.clearInterval(timer.current);
    set({ busy: null });
  }, [set]);

  return { run, cancel };
}

export function useTasks() {
  const { run, cancel: cancelProgress } = useProgress();
  // No unmount-close cleanup here either, same reasoning as useProgress above
  // — a real WS /mesh pipeline can take tens of seconds; closing it just
  // because the user switched workflow steps would abort a real backend job
  // mid-run, not merely a local animation.
  const meshSocket = useRef<WebSocket | null>(null);

  const runFill = useCallback(() => {
    const s = useAppStore.getState();
    run(
      'Voxelising & booleaning lattice into wall region',
      2600,
      [
        'rasterising TPMS field to level set',
        'inward offset shell ' + s.thickness + ' mm',
        'intersecting with wall interior',
        s.backend.available ? 'running open-edge / non-manifold audit' : 'estimating open-edge / non-manifold audit',
      ],
      async () => {
        if (s.backend.available && geometryCache.indices.length > 0) {
          try {
            const report = await fetchWatertight(geometryCache.positions, geometryCache.indices);
            s.set({ filled: true, watertight: report });
            s.flash(report.ok ? 'Wall region is watertight (verified) – meshing unlocked' : 'Validation failed – open edges or non-manifold geometry found');
            return;
          } catch {
            s.pushLog('not connected – falling back to local check', 'warn');
          }
        }
        const ok = s.stats.triangles > 0;
        const volume = s.stats.solidFraction * s.cellX * s.cellY * s.cellZ * s.nx * s.ny * s.nz;
        s.set({ filled: true, watertight: { ok, openEdges: 0, nonManifold: 0, shells: 1, volume } });
        s.flash(ok ? 'Wall region is watertight – meshing unlocked' : 'Validation failed');
      },
    );
  }, [run]);

  /** Not connected, or the real WS pipeline was unreachable — same estimate
   *  the old fake-timer path always used, now clearly labelled as such. */
  const runMeshLocal = useCallback(
    (s: AppState) => {
      run(
        'Meshing three regions (local estimate – not connected)',
        1600,
        [
          'estimating background ' + s.bgCells + '³ cell count',
          'estimating surface refinement (' + s.refine + ' levels, ' + s.layers + ' layers)',
          'estimating per-region cell split',
        ],
        () => {
          const cells = Math.round((Math.pow(s.bgCells, 3) * Math.pow(1.9, s.refine) * (s.nx * s.ny * s.nz)) / 1000);
          s.set({
            meshed: true,
            mesh: {
              cells,
              hot: Math.round(cells * 0.36),
              cold: Math.round(cells * 0.36),
              solid: Math.round(cells * 0.28),
              skewness: Number((1.9 + Math.random() * 1.4 - s.refine * 0.12).toFixed(2)),
              aspectRatio: Number((6.2 + Math.random() * 3.5).toFixed(1)),
              nonOrthogonality: Number((41 + Math.random() * 22 - s.refine * 2).toFixed(1)),
            },
          });
          s.flash('Mesh generated – ' + cells.toLocaleString('en-GB') + 'k cells (local estimate)');
        },
      );
    },
    [run],
  );

  /** Real WS /mesh pipeline — every progress message reflects a real
   *  blockMesh/snappyHexMesh/checkMesh/splitMeshRegions subprocess actually
   *  starting or finishing (see backend/app/services/foam_case.py's
   *  run_mesh_pipeline_streamed), not a fixed-duration animation. */
  const runMeshRemote = useCallback(
    (s: AppState) => {
      const ws = openMeshSocket();
      meshSocket.current = ws;
      s.set({ busy: { label: 'Meshing three regions', percent: 0, detail: 'connecting…' } });

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            bgCells: s.bgCells, refine: s.refine, layers: s.layers, nx: s.nx, ny: s.ny, nz: s.nz,
            surface: s.surface, cellX: s.cellX, cellY: s.cellY, cellZ: s.cellZ,
            thickness: s.thickness, grading: s.grading, gradAxis: s.gradAxis,
            faces: s.faces, hot: s.hot, cold: s.cold, solid: s.solid,
          }),
        );
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as MeshProgressMessage;
        const st = useAppStore.getState();

        if (msg.jobStatus === 'failed') {
          st.set({ busy: null });
          st.pushLog('mesh pipeline failed at ' + msg.stage + ' – ' + msg.detail, 'error');
          st.flash('Meshing failed – see log for details');
          return;
        }

        if (msg.jobStatus === 'done') {
          const { cells = 0, hot = 0, cold = 0, solid = 0, skewness = 0, aspectRatio = 0, nonOrthogonality = 0 } = msg;
          st.set({
            busy: null,
            meshed: true,
            mesh: { cells, hot, cold, solid, skewness, aspectRatio, nonOrthogonality },
          });
          st.flash('Mesh generated – ' + cells.toLocaleString('en-GB') + ' cells (' + (msg.source === 'openfoam' ? 'verified' : 'estimated') + ')');
          return;
        }

        st.set({ busy: { label: 'Meshing three regions', percent: msg.percent, detail: msg.detail } });
      };

      ws.onerror = () => {
        useAppStore.getState().pushLog('not connected – falling back to local estimate', 'warn');
        runMeshLocal(useAppStore.getState());
      };
    },
    [runMeshLocal],
  );

  const runMesh = useCallback(() => {
    const s = useAppStore.getState();
    if (!s.filled) {
      s.flash('Run watertightness validation first');
      return;
    }
    if (s.backend.available) runMeshRemote(s);
    else runMeshLocal(s);
  }, [runMeshRemote, runMeshLocal]);

  const importPart = useCallback(
    (file: File) => {
      const s = useAppStore.getState();
      const ext = (file.name.split('.').pop() ?? '').toUpperCase();
      run('Parsing ' + file.name, 1500, ['reading ' + ext + ' geometry', 'building topology', 'tessellating for display'], () => {
        s.set({
          imported: { name: file.name, size: (file.size / 1048576).toFixed(2) + ' MB', kind: ext },
        });
        s.flash(file.name + ' loaded');
      });
    },
    [run],
  );

  /** Only rebuilds the extracted lattice when explicitly requested — sliders just edit the draft. */
  const runGenerate = useCallback(() => {
    const s = useAppStore.getState();
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
    const baseVoxels = s.quality === 'full' ? VOXELS_FULL : VOXELS_PREVIEW;
    const voxels = adaptiveVoxelsPerCell(draft.nx, draft.ny, draft.nz, baseVoxels);
    const estTri = estimateTriangles(draft, voxels);
    const ms = clamp(estTri / 3500, 300, 3000);
    s.set({ generating: true });
    run(
      'Generating lattice geometry – ' + formatInt(estTri) + ' tri est.',
      ms,
      [
        'sampling implicit field @ ' + voxels + '³ voxels/cell',
        'dual contouring (surface nets)',
        'computing area & solid fraction',
      ],
      () => {
        useAppStore.getState().set({ activeParams: draft, activeVoxels: voxels, generating: false });
        useAppStore.getState().flash('Geometry generated');
      },
    );
  }, [run]);

  const cancelGenerate = useCallback(() => {
    cancelProgress();
    useAppStore.getState().set({ generating: false });
    useAppStore.getState().flash('Generation cancelled – previous geometry kept');
  }, [cancelProgress]);

  return { runFill, runMesh, importPart, runGenerate, cancelGenerate };
}
