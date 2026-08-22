import { useMemo } from 'react';
import { computePerformance, computeScaleUp, type PhysicsInput } from '../lib/physics';
import { useAppStore } from '../store/useAppStore';
import type { TurbulenceModel } from '../lib/types';

export function usePhysics() {
  const s = useAppStore();

  const input = useMemo<PhysicsInput>(
    () => ({
      cell: [s.cellX, s.cellY, s.cellZ],
      cells: [s.nx, s.ny, s.nz],
      thickness: s.thickness,
      solidFraction: s.stats.solidFraction,
      specificArea: s.stats.specificArea,
      hot: s.hot,
      cold: s.cold,
      solid: s.solid,
      flow: s.flow,
      nuCorrection: s.nuCorrection,
    }),
    [
      s.cellX,
      s.cellY,
      s.cellZ,
      s.nx,
      s.ny,
      s.nz,
      s.thickness,
      s.stats.solidFraction,
      s.stats.specificArea,
      s.hot,
      s.cold,
      s.solid,
      s.flow,
      s.nuCorrection,
    ],
  );

  const performance = useMemo(() => computePerformance(input), [input]);
  const scaleUp = useMemo(() => computeScaleUp(input, s.core, performance), [input, s.core, performance]);

  const effectiveTurbulence: Exclude<TurbulenceModel, 'auto'> =
    s.turbulence !== 'auto'
      ? s.turbulence
      : performance.hot.reynolds < 2300 && performance.cold.reynolds < 2300
        ? 'laminar'
        : 'kOmegaSST';

  return { input, performance, scaleUp, effectiveTurbulence };
}
