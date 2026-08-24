/** Temperature-dependent k(T)/cp(T) for the 5 built-in lattice-wall alloys.
 *
 * CoolProp has no solid-material database (it's a fluid/refrigerant equation-of-state
 * library), so there's no live external source to query the way lib/fluidProperties.ts
 * queries CoolProp. These breakpoints are typical published values for each alloy —
 * ASM Handbook / manufacturer datasheet order of magnitude (EOS AlSi10Mg, Ti-6Al-4V,
 * 316L, CuCrZr and Inconel 718 are all extremely well-documented AM/aerospace alloys)
 * — piecewise-linearly interpolated, clamped at the table's endpoints. Treat as
 * engineering-representative, not a certified per-batch material spec: real k/cp for
 * additively-manufactured parts varies with build orientation, porosity and heat
 * treatment by more than the difference between these breakpoints.
 *
 * Density is NOT modelled as temperature-dependent: thermal expansion changes it by
 * only ~1-2% over these ranges, and — unlike the fluid side — this doesn't even affect
 * a steady-state conduction solve (rho*cp only matters for transients; steady
 * chtMultiRegionSimpleFoam's solid energy equation is driven by k alone). It stays
 * exactly what the preset/custom material specifies.
 */
export const SOLID_PROPERTY_NOTE =
  'Typical literature/datasheet trends for as-built AM alloys, not a certified per-batch spec – density is treated as constant with T (negligible effect on a steady-state solve).';

interface SolidPoint {
  t: number;
  k: number;
  cp: number;
}

const TABLES: Record<string, SolidPoint[]> = {
  alsi10mg: [
    { t: 20, k: 120, cp: 900 },
    { t: 100, k: 130, cp: 940 },
    { t: 200, k: 143, cp: 990 },
    { t: 300, k: 155, cp: 1040 },
  ],
  ti64: [
    { t: 20, k: 6.7, cp: 560 },
    { t: 200, k: 8.8, cp: 610 },
    { t: 400, k: 11.5, cp: 650 },
    { t: 600, k: 14.5, cp: 680 },
  ],
  ss316: [
    { t: 20, k: 15.0, cp: 500 },
    { t: 200, k: 17.5, cp: 540 },
    { t: 400, k: 20.0, cp: 565 },
    { t: 600, k: 22.5, cp: 590 },
  ],
  cucrzr: [
    { t: 20, k: 320, cp: 390 },
    { t: 200, k: 330, cp: 400 },
    { t: 400, k: 325, cp: 415 },
    { t: 600, k: 310, cp: 430 },
  ],
  in718: [
    { t: 20, k: 11.4, cp: 435 },
    { t: 200, k: 13.0, cp: 480 },
    { t: 400, k: 15.8, cp: 520 },
    { t: 600, k: 19.6, cp: 555 },
    { t: 800, k: 23.3, cp: 600 },
  ],
};

function interp(points: SolidPoint[], t: number): { k: number; cp: number } {
  if (t <= points[0].t) return { k: points[0].k, cp: points[0].cp };
  const last = points[points.length - 1];
  if (t >= last.t) return { k: last.k, cp: last.cp };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return { k: a.k + f * (b.k - a.k), cp: a.cp + f * (b.cp - a.cp) };
    }
  }
  return { k: last.k, cp: last.cp };
}

export function isSolidCorrelated(mat: string): boolean {
  return mat in TABLES;
}

export function evaluateSolid(mat: string, tempC: number): { k: number; cp: number } | null {
  const table = TABLES[mat];
  return table ? interp(table, tempC) : null;
}

export const YIELD_STRENGTH_MPa: Record<string, number> = {
  alsi10mg: 230,
  ti64:    1000,
  ss316:    450,
  cucrzr:   300,
  in718:   1000,
};

const _BURST_SF = 2.0;

const _CURVATURE_FACTOR: Record<string, number> = {
  gyroid:  2 * Math.PI,
  schwarzp: 2 * Math.PI * 0.9,
  diamond:  2 * Math.PI * 0.8,
  iwp:      2 * Math.PI * 1.2,
};

export function tpmsMinCurvatureRadius(
  surface: string,
  cellSizeMm: number,
): number {
  const denom = _CURVATURE_FACTOR[surface] ?? (2 * Math.PI);
  return cellSizeMm / denom;
}

export interface BurstPressureResult {
  mat: string;
  yieldMPa: number;
  safetyFactor: number;
  thicknessMm: number;
  rMinMm: number;
  burstPa: number;
  burstBar: number;
  burstMPa: number;
}

export function estimateBurstPressure(
  mat: string,
  surface: string,
  cellSizeMm: number,
  thicknessMm: number,
): BurstPressureResult | null {
  const sigmaY = YIELD_STRENGTH_MPa[mat];
  if (sigmaY == null || thicknessMm <= 0) return null;

  const rMin = tpmsMinCurvatureRadius(surface, cellSizeMm);
  if (rMin <= 0) return null;

  const sigmaPa = sigmaY * 1e6;
  const tM      = thicknessMm / 1000;
  const rM      = rMin / 1000;
  const pPa     = (2 * sigmaPa * tM) / (rM * _BURST_SF);

  return {
    mat,
    yieldMPa:     sigmaY,
    safetyFactor: _BURST_SF,
    thicknessMm,
    rMinMm:       Math.round(rMin * 10000) / 10000,
    burstPa:      pPa,
    burstBar:     pPa / 1e5,
    burstMPa:     pPa / 1e6,
  };
}
