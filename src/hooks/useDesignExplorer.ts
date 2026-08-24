import { useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { openExplorerSocket, type ExplorerMessage } from '../lib/api';

export interface ExploreSweepInput {
  thicknessRange: [number, number];
  cellScaleRange: [number, number];
  sampleCount: number;
}

/**
 * Drives WS /design-explorer: a real multi-objective sweep over wall
 * thickness and overall unit-cell scale. The backend pre-screens a larger
 * candidate pool with the quick-estimate surrogate (when enough real history
 * exists for this surface) but only ever reports a Pareto front computed
 * from candidates that were actually meshed and solved — see
 * backend/app/routers/explorer.py's module docstring.
 */
export function useDesignExplorer() {
  const socket = useRef<WebSocket | null>(null);

  const start = useCallback((input: ExploreSweepInput) => {
    const s = useAppStore.getState();
    if (!s.backend.available) {
      s.flash('The design explorer needs a live connection – not available as an in-browser stand-in');
      return;
    }
    if (s.explorer.running) return;

    s.set({
      explorer: { running: true, phase: 'running', poolSize: 0, screened: false, total: input.sampleCount, currentIndex: null, candidates: [], error: null },
    });

    const ws = openExplorerSocket();
    socket.current = ws;

    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          thicknessRange: input.thicknessRange,
          cellScaleRange: input.cellScaleRange,
          sampleCount: input.sampleCount,
          bgCells: s.bgCells,
          maxIterations: s.maxIterations,
          residualTarget: Number.parseFloat(s.residualTarget),
          surface: s.surface, cellX: s.cellX, cellY: s.cellY, cellZ: s.cellZ,
          grading: s.grading, gradAxis: s.gradAxis,
          nx: s.nx, ny: s.ny, nz: s.nz,
          faces: s.faces, hot: s.hot, cold: s.cold, solid: s.solid,
        }),
      );

    ws.onmessage = (ev) => {
      const raw = JSON.parse(ev.data) as ExplorerMessage | { stage: 'queued'; detail: string };
      const st = useAppStore.getState();

      if ('stage' in raw && raw.stage === 'queued') {
        st.pushLog(raw.detail, 'info');
        return;
      }

      const msg = raw as ExplorerMessage;
      if (msg.phase === 'pool') {
        st.set({ explorer: { ...st.explorer, poolSize: msg.poolSize, screened: msg.screened } });
      } else if (msg.phase === 'candidate_meshing' || msg.phase === 'candidate_meshed' || msg.phase === 'candidate_solving') {
        st.set({ explorer: { ...st.explorer, currentIndex: msg.index } });
      } else if (msg.phase === 'candidate_done') {
        st.set({
          explorer: {
            ...st.explorer,
            candidates: st.explorer.candidates.concat([{ ...msg, paretoFront: false }]),
          },
        });
      } else if (msg.phase === 'failed') {
        st.pushLog('design-explorer candidate failed – ' + msg.error, 'warn');
      } else if (msg.phase === 'complete') {
        st.set({
          explorer: { ...st.explorer, running: false, phase: 'complete', currentIndex: null, candidates: msg.candidates },
        });
        st.flash('Design explorer complete – ' + msg.candidates.length + ' candidates solved');
      }
    };

    ws.onerror = () => {
      const st = useAppStore.getState();
      st.set({ explorer: { ...st.explorer, running: false, phase: 'failed', error: 'not connected' } });
      st.pushLog('not connected – the design explorer needs a live connection', 'warn');
    };

    ws.onclose = () => {
      if (socket.current === ws) socket.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    socket.current?.close();
    socket.current = null;
    const s = useAppStore.getState();
    s.set({ explorer: { ...s.explorer, running: false, phase: 'idle' } });
  }, []);

  return { start, cancel };
}
