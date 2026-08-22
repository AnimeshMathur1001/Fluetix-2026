import { useEffect } from 'react';
import { fetchResults, putCase } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import type { PhysicsInput } from '../lib/physics';

const CASE_ID = 'live';

/**
 * Mount once (App.tsx) — usePhysics() itself is called from ~8 components, so
 * doing the backend round trip there would fire that many duplicate
 * POST /cases + GET /results per change. This debounces and dedupes it in one
 * place instead, writing the result to store.backendPerformance.
 */
export function useBackendResultsSync() {
  const backendAvailable = useAppStore((s) => s.backend.available);
  const cellX = useAppStore((s) => s.cellX);
  const cellY = useAppStore((s) => s.cellY);
  const cellZ = useAppStore((s) => s.cellZ);
  const nx = useAppStore((s) => s.nx);
  const ny = useAppStore((s) => s.ny);
  const nz = useAppStore((s) => s.nz);
  const thickness = useAppStore((s) => s.thickness);
  const solidFraction = useAppStore((s) => s.stats.solidFraction);
  const specificArea = useAppStore((s) => s.stats.specificArea);
  const hot = useAppStore((s) => s.hot);
  const cold = useAppStore((s) => s.cold);
  const solid = useAppStore((s) => s.solid);
  const flow = useAppStore((s) => s.flow);
  const nuCorrection = useAppStore((s) => s.nuCorrection);

  useEffect(() => {
    if (!backendAvailable) {
      useAppStore.getState().set({ backendPerformance: null });
      return;
    }
    const input: PhysicsInput = {
      cell: [cellX, cellY, cellZ],
      cells: [nx, ny, nz],
      thickness,
      solidFraction,
      specificArea,
      hot,
      cold,
      solid,
      flow,
      nuCorrection,
    };
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        await putCase(CASE_ID, input);
        const result = await fetchResults(CASE_ID);
        if (!cancelled) useAppStore.getState().set({ backendPerformance: result });
      } catch {
        if (!cancelled) useAppStore.getState().set({ backendPerformance: null });
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [backendAvailable, cellX, cellY, cellZ, nx, ny, nz, thickness, solidFraction, specificArea, hot, cold, solid, flow, nuCorrection]);
}
