import { useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { openSolveSocket, type SolveMessage } from '../lib/api';

// hSolid decays slower than the fluid-side residuals to mirror real CFD
// behaviour: a thin, highly-conductive solid wall has a low Biot number and
// settles far more slowly than the fluid regions (confirmed against a real
// solve — see backend/app/routers/solve.py).
const DECAY = { ux: 150, p: 110, hHot: 190, hCold: 185, hSolid: 340 };
const START = { ux: 0.9, p: 1.0, hHot: 0.6, hCold: 0.55, hSolid: 0.5 };

/** The queue's own announcement (services/queue.py's JobQueue.slot) shares the
 *  connection before real solve messages start — same `stage`/`jobStatus`
 *  shape WS /mesh uses, distinguished from a real SolveMessage by `stage`. */
interface QueuedMessage {
  stage: 'queued';
  detail: string;
}

/**
 * Drives the residual stream: a real `WS /solve` connection when the backend
 * is reachable, otherwise the in-browser exponential-decay stand-in. Both
 * currently produce the *same kind* of synthetic residuals — see backend
 * services/foam.py for the seam where a real subprocess replaces the server
 * side of this once the solver is installed.
 *
 * Deliberately no unmount-cleanup effect: this is called fresh inside
 * MeshSolvePanel (and CommandPalette), and MeshSolvePanel unmounts every time
 * the user switches to a different workflow step. A real solve can run for
 * many minutes — closing its socket just because the user clicked over to
 * Results to check something would silently abort a real, possibly
 * near-converged CFD run with no error shown. `onmessage` only touches the
 * global Zustand store, so it's safe to keep updating it long after the
 * component that opened the socket has unmounted — same reasoning as
 * useTasks.ts's useProgress/meshSocket, and the same pattern already used
 * (correctly) by useMeshIndependence/useUncertaintyBand/useDesignExplorer.
 */
export function useSolver() {
  const timer = useRef<number | undefined>(undefined);
  const socket = useRef<WebSocket | null>(null);

  const runLocal = useCallback((target: number) => {
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      const st = useAppStore.getState();
      const iteration = st.iteration + 12;

      const next = (arr: number[], r0: number, tau: number) =>
        arr.concat([r0 * Math.exp(-iteration / tau) * (0.7 + Math.random() * 0.6)]);

      const residuals = {
        ux: next(st.residuals.ux, START.ux, DECAY.ux),
        p: next(st.residuals.p, START.p, DECAY.p),
        hHot: next(st.residuals.hHot, START.hHot, DECAY.hHot),
        hCold: next(st.residuals.hCold, START.hCold, DECAY.hCold),
        hSolid: next(st.residuals.hSolid, START.hSolid, DECAY.hSolid),
      };

      const last = [residuals.ux, residuals.p, residuals.hHot, residuals.hCold, residuals.hSolid].map(
        (a) => a[a.length - 1],
      );
      const converged = last.every((v) => v < target);
      const stop = converged || iteration >= st.maxIterations;

      st.set({
        iteration,
        residuals,
        solving: !stop,
        converged: stop ? converged : null,
        jobStatus: stop ? (converged ? 'done' : 'failed') : st.jobStatus,
      });

      if (stop) window.clearInterval(timer.current);
    }, 55);
  }, []);

  const runRemote = useCallback(
    (target: number, maxIterations: number) => {
      const ws = openSolveSocket();
      socket.current = ws;

      ws.onopen = () => {
        const s = useAppStore.getState();
        // Full case spec is optional (see backend/app/routers/solve.py's
        // docstring) — sending it lets a converged run log its real solved
        // performance to the design-history log the quick-estimate feature
        // (lib/api.ts's fetchEstimate) learns from; solving works identically
        // either way.
        ws.send(
          JSON.stringify({
            maxIterations,
            residualTarget: target,
            surface: s.surface, cellX: s.cellX, cellY: s.cellY, cellZ: s.cellZ,
            thickness: s.thickness, grading: s.grading, gradAxis: s.gradAxis,
            faces: s.faces, hot: s.hot, cold: s.cold, solid: s.solid,
          }),
        );
      };

      ws.onmessage = (ev) => {
        const raw = JSON.parse(ev.data) as SolveMessage | QueuedMessage;
        const st = useAppStore.getState();

        if ('stage' in raw && raw.stage === 'queued') {
          st.set({ jobStatus: 'queued' });
          st.pushLog(raw.detail, 'info');
          return;
        }

        const msg = raw as SolveMessage;
        st.set({
          iteration: msg.iteration,
          residuals: {
            ux: st.residuals.ux.concat(msg.residuals.ux),
            p: st.residuals.p.concat(msg.residuals.p),
            hHot: st.residuals.hHot.concat(msg.residuals.hHot),
            hCold: st.residuals.hCold.concat(msg.residuals.hCold),
            hSolid: st.residuals.hSolid.concat(msg.residuals.hSolid),
          },
          solving: msg.jobStatus === 'running',
          converged: msg.converged,
          jobStatus: msg.jobStatus,
          // A completed real solve is the only thing that makes the solved-
          // field contour view meaningful — not convergence (even a
          // non-converged run wrote genuine field data), and never the
          // synthetic stand-in.
          solvedFieldReady: msg.jobStatus === 'done' && msg.source === 'openfoam' ? true : st.solvedFieldReady,
        });
        if (msg.jobStatus === 'done' || msg.jobStatus === 'failed') {
          st.pushLog(msg.jobStatus === 'done' ? 'solve complete' : 'solve stopped — iteration limit or divergence', msg.jobStatus === 'done' ? 'ok' : 'warn');
        }
      };

      ws.onerror = () => {
        useAppStore.getState().pushLog('not connected — falling back to local solver stand-in', 'warn');
        runLocal(target);
      };

      ws.onclose = () => {
        if (socket.current === ws) socket.current = null;
      };
    },
    [runLocal],
  );

  const start = useCallback(() => {
    const s = useAppStore.getState();
    if (!s.meshed) {
      s.flash('Generate the mesh first');
      return;
    }
    if (s.solving) return;

    const target = Number.parseFloat(s.residualTarget);
    s.set({
      solving: true,
      iteration: 0,
      residuals: { ux: [], p: [], hHot: [], hCold: [], hSolid: [] },
      converged: null,
      probe: null,
      jobStatus: s.backend.available ? 'running' : 'local',
      solvedFieldReady: false, // invalidate until this run actually completes
    });

    if (s.backend.available) runRemote(target, s.maxIterations);
    else runLocal(target);
  }, [runLocal, runRemote]);

  const cancel = useCallback(() => {
    const s = useAppStore.getState();
    window.clearInterval(timer.current);
    socket.current?.close();
    socket.current = null;
    s.set({ solving: false, converged: false, jobStatus: 'cancelled' });
    s.pushLog('run cancelled by user', 'error');
  }, []);

  return { start, cancel };
}
