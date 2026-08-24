import { useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { openMeshIndependenceSocket, type MeshIndependenceMessage } from '../lib/api';

/**
 * Drives WS /mesh-independence: a genuine grid-convergence study. Distinct
 * from periodicity/block-independence, a *different*, still-unbuilt check
 * that used to have a fake-numbers stand-in in this app and was removed
 * entirely rather than kept as a placeholder. This reruns the real
 * blockMesh -> snappyHexMesh ->
 * splitMeshRegions -> chtMultiRegionSimpleFoam pipeline once per requested
 * background-mesh resolution and reports how far a solved-field-derived
 * metric (pressure drop, effectiveness) moves between resolutions.
 *
 * Backend-only: unlike useSolver, there is no honest in-browser synthetic
 * fallback for "does this result depend on mesh resolution" — that question
 * only means anything against the real pipeline, so this simply fails
 * (flash + idle) when the backend isn't reachable, rather than faking it.
 */
export function useMeshIndependence() {
  const socket = useRef<WebSocket | null>(null);

  const start = useCallback((levels: number[]) => {
    const s = useAppStore.getState();
    if (!s.backend.available) {
      const error = 'Mesh independence needs a live connection to the backend and a working OpenFOAM install (see backend/README.md) – not available as an in-browser stand-in';
      s.set({ meshIndependence: { ...s.meshIndependence, running: false, phase: 'failed', error } });
      s.flash(error);
      return;
    }
    if (s.meshIndependence.running) return;

    s.set({
      meshIndependence: {
        running: true,
        phase: 'running',
        levelTotal: levels.length,
        levels: levels.map((level) => ({ level, phase: 'meshing', iteration: 0 })),
        results: [],
        convergence: null,
        error: null,
        gciRows: null,
      },
    });

    const ws = openMeshIndependenceSocket();
    socket.current = ws;

    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          meshLevels: levels,
          maxIterations: s.maxIterations,
          residualTarget: Number.parseFloat(s.residualTarget),
          surface: s.surface, cellX: s.cellX, cellY: s.cellY, cellZ: s.cellZ,
          thickness: s.thickness, grading: s.grading, gradAxis: s.gradAxis,
          nx: s.nx, ny: s.ny, nz: s.nz,
          faces: s.faces, hot: s.hot, cold: s.cold, solid: s.solid,
        }),
      );

    // Levels mesh and solve concurrently and interleave their messages on
    // this one socket (see backend docstring), so each message must update
    // only its own level's entry — never a single shared "current" field,
    // which would make a slower level's message stomp a faster level's
    // progress and look like solving randomly resets.
    const patchLevel = (level: number, patch: Partial<import('../lib/types').MeshIndependenceLevelProgress>) => {
      const st = useAppStore.getState();
      st.set({
        meshIndependence: {
          ...st.meshIndependence,
          levels: st.meshIndependence.levels.map((lv) => (lv.level === level ? { ...lv, ...patch } : lv)),
        },
      });
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as MeshIndependenceMessage;
      const st = useAppStore.getState();

      if (msg.phase === 'meshing') {
        patchLevel(msg.level, { phase: 'meshing', iteration: 0 });
      } else if (msg.phase === 'meshed') {
        patchLevel(msg.level, { phase: 'meshed' });
      } else if (msg.phase === 'solving') {
        patchLevel(msg.level, { phase: 'solving', iteration: msg.iteration });
      } else if (msg.phase === 'level_done') {
        patchLevel(msg.level, { phase: 'done' });
        st.set({
          meshIndependence: {
            ...st.meshIndependence,
            results: st.meshIndependence.results.concat([{ level: msg.level, cells: msg.cells, performance: msg.performance }]),
          },
        });
      } else if (msg.phase === 'failed') {
        if (msg.level != null) patchLevel(msg.level, { phase: 'failed' });
        st.set({ meshIndependence: { ...st.meshIndependence, running: false, phase: 'failed', error: msg.error } });
        st.flash('Mesh independence study failed' + (msg.level != null ? ' at level ' + msg.level : '') + ' – ' + msg.error);
        ws.close();
      } else if (msg.phase === 'complete') {
        st.set({
          meshIndependence: {
            ...st.meshIndependence,
            running: false,
            phase: 'complete',
            results: msg.levels.map((l) => ({ level: l.level, cells: l.cells, performance: l.performance })),
            convergence: msg.convergence,
            gciRows: msg.convergence?.rows ?? null,
          },
        });
        st.flash('Mesh independence study complete – ' + msg.levels.length + ' resolutions run');
      }
    };

    ws.onerror = () => {
      const st = useAppStore.getState();
      st.set({ meshIndependence: { ...st.meshIndependence, running: false, phase: 'failed', error: 'WS /mesh-independence unreachable' } });
      st.pushLog('not connected – mesh independence needs a live connection', 'warn');
    };

    ws.onclose = () => {
      if (socket.current === ws) socket.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    socket.current?.close();
    socket.current = null;
    const s = useAppStore.getState();
    s.set({ meshIndependence: { ...s.meshIndependence, running: false, phase: 'idle' } });
  }, []);

  return { start, cancel };
}
