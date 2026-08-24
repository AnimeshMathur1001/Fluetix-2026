import { useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { openUncertaintySocket, type UncertaintyMessage } from '../lib/api';

/**
 * Drives WS /uncertainty: reruns the real mesh+solve pipeline at the case's
 * nominal wall thickness and at thickness ± a manufacturing tolerance, so the
 * reported performance is a real band ("effectiveness 0.71–0.76") rather than
 * one number that quietly assumes the as-printed part comes out exact. No
 * honest in-browser fallback — like mesh independence, this question only
 * means anything against the real pipeline.
 */
export function useUncertaintyBand() {
  const socket = useRef<WebSocket | null>(null);

  const start = useCallback((toleranceMm: number) => {
    const s = useAppStore.getState();
    if (!s.backend.available) {
      const error = 'Tolerance sensitivity needs a live connection to the backend and a working OpenFOAM install (see backend/README.md) – not available as an in-browser stand-in';
      s.set({ uncertainty: { ...s.uncertainty, running: false, phase: 'failed', error } });
      s.flash(error);
      return;
    }
    if (s.uncertainty.running) return;

    s.set({ uncertainty: { running: true, phase: 'running', currentVariant: 'nominal', variants: [], bands: null, error: null } });

    const ws = openUncertaintySocket();
    socket.current = ws;

    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          thicknessTolerance: toleranceMm,
          bgCells: s.bgCells,
          maxIterations: s.maxIterations,
          residualTarget: Number.parseFloat(s.residualTarget),
          surface: s.surface, cellX: s.cellX, cellY: s.cellY, cellZ: s.cellZ,
          thickness: s.thickness, grading: s.grading, gradAxis: s.gradAxis,
          nx: s.nx, ny: s.ny, nz: s.nz,
          faces: s.faces, hot: s.hot, cold: s.cold, solid: s.solid,
        }),
      );

    ws.onmessage = (ev) => {
      const raw = JSON.parse(ev.data) as UncertaintyMessage | { stage: 'queued'; detail: string };
      const st = useAppStore.getState();

      if ('stage' in raw && raw.stage === 'queued') {
        st.pushLog(raw.detail, 'info');
        return;
      }

      const msg = raw as UncertaintyMessage;
      if (msg.phase === 'meshing' || msg.phase === 'meshed' || msg.phase === 'solving') {
        st.set({ uncertainty: { ...st.uncertainty, currentVariant: msg.variant } });
      } else if (msg.phase === 'variant_done') {
        st.set({
          uncertainty: {
            ...st.uncertainty,
            variants: st.uncertainty.variants.concat([{ variant: msg.variant, thickness: msg.thickness, performance: msg.performance }]),
          },
        });
      } else if (msg.phase === 'failed') {
        st.set({ uncertainty: { ...st.uncertainty, running: false, phase: 'failed', error: msg.error } });
        st.flash('Tolerance sensitivity failed' + (msg.variant ? ' at ' + msg.variant : '') + ' – ' + msg.error);
        ws.close();
      } else if (msg.phase === 'complete') {
        st.set({
          uncertainty: { ...st.uncertainty, running: false, phase: 'complete', currentVariant: null, bands: msg.bands.rows },
        });
        st.flash('Tolerance sensitivity complete');
      }
    };

    ws.onerror = () => {
      const st = useAppStore.getState();
      st.set({ uncertainty: { ...st.uncertainty, running: false, phase: 'failed', error: 'not connected' } });
      st.pushLog('not connected – tolerance sensitivity needs a live connection', 'warn');
    };

    ws.onclose = () => {
      if (socket.current === ws) socket.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    socket.current?.close();
    socket.current = null;
    const s = useAppStore.getState();
    s.set({ uncertainty: { ...s.uncertainty, running: false, phase: 'idle' } });
  }, []);

  return { start, cancel };
}
