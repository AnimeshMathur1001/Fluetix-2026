/**
 * Temperature-dependent fluid property correlations.
 *
 * There is no CoolProp (or any Python/C++ property engine) available in this browser-only
 * build — CoolProp cannot run client-side. These are hand-fit engineering correlations
 * (water viscosity uses the real Vogel/Andrade-form equation; the rest are polynomial or
 * exponential fits through published reference-table values). They are good enough for
 * conceptual design and are clearly an approximation, not a metrologically exact equation
 * of state. Swap this module for a FastAPI + CoolProp endpoint call when the backend lands
 * (see README).
 */

export interface FluidState {
  rho: number;
  mu: number;
  cp: number;
  k: number;
}

export type FluidCorrelationKey = 'water' | 'air' | 'eg50' | 'oil' | 'hydrogen';

interface Correlation {
  fn: (tC: number) => FluidState;
  range: [number, number];
}

const CORRELATIONS: Record<FluidCorrelationKey, Correlation> = {
  water: {
    range: [0, 150],
    fn: (t) => ({
      rho: 999.8 - 0.054 * t - 0.00364 * t * t,
      // Vogel equation — the one entry here that is a genuine, accurate physical fit.
      mu: 2.414e-5 * Math.pow(10, 247.8 / (t + 273.15 - 140)),
      cp: 4217.4 - 3.720283 * t + 0.1412855 * t * t - 2.654387e-3 * t ** 3 + 2.093236e-5 * t ** 4,
      k: 0.561 + 0.00214 * t - 9.6e-6 * t * t,
    }),
  },
  air: {
    range: [-20, 400],
    fn: (t) => {
      const tk = t + 273.15;
      const mu0 = 1.716e-5;
      const t0 = 273.15;
      const c = 110.4;
      return {
        rho: 101325 / (287.05 * tk),
        mu: mu0 * ((t0 + c) / (tk + c)) * Math.pow(tk / t0, 1.5),
        cp: 1006 + 0.0605 * t,
        k: 0.0241 + 7.1e-5 * t,
      };
    },
  },
  hydrogen: {
    range: [-20, 400],
    fn: (t) => {
      const tk = t + 273.15;
      const muRef = 8.76e-6;
      const tRef = 293.85;
      const c = 72;
      return {
        rho: 101325 / (4124.2 * tk),
        mu: muRef * ((tRef + c) / (tk + c)) * Math.pow(tk / tRef, 1.5),
        cp: 14300 + 0.5 * t,
        k: 0.182 + 0.00045 * t,
      };
    },
  },
  eg50: {
    range: [0, 110],
    fn: (t) => ({
      rho: 1087 - 0.62 * t,
      mu: 3.5e-3 * Math.exp(-0.03 * (t - 40)),
      cp: 3300 + 1.8 * (t - 40),
      k: 0.39 + 0.0008 * (t - 40),
    }),
  },
  oil: {
    range: [0, 150],
    fn: (t) => ({
      rho: 860 - 0.6 * (t - 60),
      mu: 0.024 * Math.exp(-0.035 * (t - 60)),
      cp: 1900 + 3.2 * (t - 60),
      k: 0.13 - 0.00012 * (t - 60),
    }),
  },
};

export const CORRELATION_NOTE =
  'Water/air/hydrogen/eg50/oil show an instant local estimate (Vogel/Sutherland/polynomial fits — ' +
  'no property database runs client-side) that gets upgraded to a verified value a moment after the ' +
  'server responds. Every other fluid in the search list — well over a hundred — is evaluated ' +
  'server-side only, genuinely as a function of both inlet temperature and outlet pressure.';

export function isCorrelated(key: string): key is FluidCorrelationKey {
  return key in CORRELATIONS;
}

/** Evaluates density, viscosity, specific heat and conductivity at the given temperature. */
export function evaluateFluid(key: string, tempC: number): FluidState | null {
  if (!isCorrelated(key)) return null;
  const { fn, range } = CORRELATIONS[key];
  const t = Math.max(range[0], Math.min(range[1], tempC));
  return fn(t);
}

export function fluidRange(key: string): [number, number] | null {
  return isCorrelated(key) ? CORRELATIONS[key].range : null;
}
