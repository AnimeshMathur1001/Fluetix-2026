/** Convergence-oriented value recommendations shown alongside the real
 * inputs that feed the actual mesh/solve pipeline — deliberately NOT applied
 * to the Geometry step (lattice/surface/cell-size/thickness), since those
 * are shape decisions, not convergence knobs. Every reason here traces back
 * to something actually observed against the real solver, not generic
 * advice: see foam_solve.py's solid-plateau fix (a thin, coarsely-resolved
 * wall's own energy-equation residual can misleadingly plateau) and the
 * mesh-independence concurrency work earlier this project for the evidence
 * behind the bgCells/maxIterations/residualTarget thresholds below. */

export type RecommendationStatus = 'ok' | 'suggest';

export interface Recommendation {
  id: string;
  label: string;
  current: string;
  recommended: string;
  reason: string;
  status: RecommendationStatus;
  apply?: () => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How many background cells should span the thinnest wall dimension before
 * the solid region has enough internal resolution to behave like a real 3D
 * field rather than 1-2 cells straddling both coupled faces at once — the
 * exact mechanism confirmed behind the "hSolid residual stuck at 1" case. */
const MIN_CELLS_ACROSS_WALL = 3;

export function meshRecommendations(args: {
  bgCells: number;
  cellX: number;
  cellY: number;
  cellZ: number;
  thickness: number;
  refine: number;
  layers: number;
  maxIterations: number;
  residualTarget: string;
  applyBgCells: (v: number) => void;
  applyRefine: (v: number) => void;
  applyLayers: (v: number) => void;
  applyMaxIterations: (v: number) => void;
  applyResidualTarget: (v: string) => void;
}): Recommendation[] {
  const minCell = Math.min(args.cellX, args.cellY, args.cellZ);
  const cellsAcrossWall = (args.thickness * args.bgCells) / minCell;
  const recommendedBgCells = clamp(
    Math.ceil((MIN_CELLS_ACROSS_WALL * minCell) / args.thickness),
    12,
    60,
  );

  const out: Recommendation[] = [];

  out.push({
    id: 'bgCells',
    label: 'Background cells / axis',
    current: String(args.bgCells),
    recommended: String(recommendedBgCells),
    reason:
      cellsAcrossWall < MIN_CELLS_ACROSS_WALL
        ? `Only ~${cellsAcrossWall.toFixed(1)} background cells span the wall thickness at this resolution — the solid region ends up with almost no internal structure, so its own energy-equation residual can sit flat for a long stretch even after the fluid has genuinely converged (the solver now detects and works around this, but a properly resolved wall settles cleaner and faster). ${recommendedBgCells}³ gets you to ~${MIN_CELLS_ACROSS_WALL}.`
        : `~${cellsAcrossWall.toFixed(1)} background cells already span the wall thickness — enough internal resolution that the solid region behaves like a real 3D field, not a coarse 1-2 cell approximation.`,
    status: args.bgCells >= recommendedBgCells ? 'ok' : 'suggest',
    apply: () => args.applyBgCells(recommendedBgCells),
  });

  out.push({
    id: 'refine',
    label: 'Surface refinement level',
    current: String(args.refine),
    recommended: '2',
    reason:
      args.refine < 1
        ? 'Level 0 leaves the fluid-solid interface unrefined — a jagged coupled boundary shows up as noisier, slower-settling residuals. Level 1-2 resolves it cleanly without a large cell-count cost.'
        : 'The coupled interface has enough refinement to resolve a clean boundary, which keeps the coupled residuals from picking up mesh-driven noise.',
    status: args.refine >= 1 ? 'ok' : 'suggest',
    apply: () => args.applyRefine(2),
  });

  out.push({
    id: 'layers',
    label: 'Boundary layers',
    current: String(args.layers),
    recommended: '3',
    reason:
      args.layers < 2
        ? 'Too few boundary layers leave the near-wall gradient under-resolved on a single coarse cell, which is exactly the kind of under-resolution that slows convergence at the coupled interface. 2-4 layers is the usual sweet spot.'
        : args.layers > 5
          ? 'More than ~5 layers on a thin lattice wall tends to produce highly skewed cells near the interface, which can hurt convergence more than it helps resolution.'
          : 'Enough boundary layers to resolve the near-wall gradient without over-stacking skewed cells at the interface.',
    status: args.layers >= 2 && args.layers <= 5 ? 'ok' : 'suggest',
    apply: () => args.applyLayers(3),
  });

  out.push({
    id: 'maxIterations',
    label: 'Max iterations',
    current: String(args.maxIterations),
    recommended: '2000',
    reason:
      args.maxIterations < 2000
        ? "The fluid side (velocity/pressure/enthalpy) typically settles first; the solid wall's own energy balance can keep moving for another 1000+ iterations after that even though the chart looks flat. A lower cap can cut the run off mid-transient before it's actually done."
        : 'High enough that the solid wall gets room to finish its slower thermal settling after the fluid side converges, instead of being cut off mid-transient.',
    status: args.maxIterations >= 2000 ? 'ok' : 'suggest',
    apply: () => args.applyMaxIterations(2000),
  });

  out.push({
    id: 'residualTarget',
    label: 'Residual target',
    current: args.residualTarget,
    recommended: '1e-5',
    reason:
      args.residualTarget === '1e-4'
        ? '1e-4 can call it converged before the solid wall has genuinely settled. 1e-5 is tight enough to trust without chasing solver noise the way 1e-6 sometimes does.'
        : args.residualTarget === '1e-6'
          ? "Tighter than necessary — 1e-6 rarely changes the result but can cost hundreds of extra iterations. Not wrong, just slower than it needs to be for most cases."
          : '1e-5 is tight enough to trust the result without chasing solver noise the way a tighter target sometimes does.',
    status: args.residualTarget === '1e-4' ? 'suggest' : 'ok',
    apply: () => args.applyResidualTarget('1e-5'),
  });

  return out;
}

/** Minimum Reynolds number below which flow is weak enough that the coupled
 * wall barely receives any real driving signal — the same underlying
 * mechanism (weak gradients → degenerate/slow residuals) as the bgCells
 * case above, just from the flow side instead of the mesh side. */
const MIN_RECOMMENDED_RE = 300;
const TARGET_RE_WHEN_LOW = 500;

export function flowRecommendation(args: {
  which: 'hot' | 'cold';
  mdot: number;
  reynolds: number;
  applyMdot: (v: number) => void;
}): Recommendation {
  const label = (args.which === 'hot' ? 'Hot' : 'Cold') + ' mass flow ṁ';
  if (!(args.reynolds > 0) || args.reynolds >= MIN_RECOMMENDED_RE) {
    return {
      id: args.which + 'Mdot',
      label,
      current: args.mdot.toFixed(4) + ' kg/s',
      recommended: args.mdot.toFixed(4) + ' kg/s',
      reason: `Re ≈ ${args.reynolds.toFixed(0)} — comfortably above the near-stagnant range, so this stream drives real heat transfer into the coupled wall each iteration.`,
      status: 'ok',
    };
  }
  const recommendedMdot = args.mdot * (TARGET_RE_WHEN_LOW / args.reynolds);
  return {
    id: args.which + 'Mdot',
    label,
    current: args.mdot.toFixed(4) + ' kg/s',
    recommended: recommendedMdot.toFixed(4) + ' kg/s',
    reason: `Re ≈ ${args.reynolds.toFixed(0)} is very weak flow — little convective heat transfer means the coupled wall barely moves each iteration, which is the same "looks stalled" pattern a badly-resolved wall shows. Re ≈ ${TARGET_RE_WHEN_LOW} keeps the coupling strong enough to settle promptly.`,
    status: 'suggest',
    apply: () => args.applyMdot(recommendedMdot),
  };
}

/** Informational only — not something to "apply," just useful context so a
 * long-looking solve on a low-conductivity wall isn't mistaken for a hang. */
export function solidConductivityNote(k: number, thicknessMm: number): string | null {
  if (k >= 20 || thicknessMm > 1.5) return null;
  return `This wall's conductivity (k = ${k} W/m·K) combined with its thin lattice wall means the solid region's own residual can sit flat for a while after the fluid side converges — expected for this material/thickness combination, not a stall. The solver detects this automatically and keeps going until the field genuinely settles.`;
}
