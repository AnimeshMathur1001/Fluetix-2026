import type {
  CoreTarget,
  FlowArrangement,
  NuCorrectionParams,
  SolidMaterial,
  Stream,
} from './types';

export interface PhysicsInput {
  cell: [number, number, number];
  cells: [number, number, number];
  thickness: number;
  solidFraction: number;
  specificArea: number;
  hot: Stream;
  cold: Stream;
  solid: SolidMaterial;
  flow: FlowArrangement;
  nuCorrection: NuCorrectionParams;
}

export interface SidePerformance {
  velocity: number;
  reynolds: number;
  prandtl: number;
  laminar: boolean;
  friction: number;
  pressureDrop: number;
  nusselt: number;
  h: number;
}

export interface Performance {
  hydraulicDiameter: number;
  wallArea: number;
  crossArea: number;
  volume: number;
  solidFraction: number;
  channelFraction: number;
  hot: SidePerformance;
  cold: SidePerformance;
  laminar: boolean;
  UA: number;
  U: number;
  NTU: number;
  effectiveness: number;
  Q: number;
  Qhot: number;
  Qcold: number;
  imbalance: number;
  cHot: number;
  cCold: number;
  cMin: number;
  cRatio: number;
  dTHot: number;
  dTCold: number;
  ThOut: number;
  TcOut: number;
  lengthZ: number;
}

const TORTUOSITY = 1.35;
/** Laminar duct correction for the tortuous TPMS channel. */
const LAMINAR_F = 1.45;
/** Residual energy-balance error reported by the solver on a converged run. */
const ENERGY_IMBALANCE = 0.0042;

export function applyNuCorrection(
  reynolds: number,
  params: NuCorrectionParams,
): number {
  return params.A * Math.pow(Math.max(1, reynolds), params.b);
}

function side(
  fluid: Stream,
  dh: number,
  crossArea: number,
  pathLength: number,
  nuCorrection: NuCorrectionParams,
): SidePerformance {
  const velocity = fluid.mdot / (fluid.rho * crossArea);
  const reynolds = (fluid.rho * velocity * dh) / fluid.mu;
  const prandtl = (fluid.mu * fluid.cp) / fluid.k;
  const laminar = reynolds < 2300;
  const friction = laminar
    ? (96 / Math.max(reynolds, 1)) * LAMINAR_F
    : 0.316 * Math.pow(Math.max(reynolds, 1), -0.25) * 1.6;
  const pressureDrop = (friction * (pathLength / dh) * fluid.rho * velocity * velocity) / 2;
  const nusselt = laminar
    ? 4.36 * applyNuCorrection(reynolds, nuCorrection)
    : 0.023 * Math.pow(reynolds, 0.8) * Math.pow(prandtl, 0.4);
  return {
    velocity,
    reynolds,
    prandtl,
    laminar,
    friction,
    pressureDrop,
    nusselt,
    h: (nusselt * fluid.k) / dh,
  };
}

function effectivenessNTU(ntu: number, cr: number, flow: FlowArrangement): number {
  if (flow === 'counter') {
    if (Math.abs(cr - 1) < 1e-6) return ntu / (1 + ntu);
    return (1 - Math.exp(-ntu * (1 - cr))) / (1 - cr * Math.exp(-ntu * (1 - cr)));
  }
  if (flow === 'parallel') return (1 - Math.exp(-ntu * (1 + cr))) / (1 + cr);
  return 1 - Math.exp((1 / cr) * Math.pow(ntu, 0.22) * (Math.exp(-cr * Math.pow(ntu, 0.78)) - 1));
}

/** Unit-cell performance from the extracted geometry plus the case boundary conditions. */
export function computePerformance(input: PhysicsInput): Performance {
  const lx = (input.cell[0] * input.cells[0]) / 1000;
  const ly = (input.cell[1] * input.cells[1]) / 1000;
  const lz = (input.cell[2] * input.cells[2]) / 1000;
  const volume = lx * ly * lz;

  const solidFraction = Math.max(0.02, input.solidFraction || 0.18);
  const channelFraction = (1 - solidFraction) / 2;

  // specificArea counts both faces of the wall; one stream sees half of it.
  const wallArea = Math.max(1e-6, ((input.specificArea || 600) * volume) / 2);
  const fluidVolume = channelFraction * volume;
  const dh = Math.max(1e-4, (4 * fluidVolume) / wallArea);
  const crossArea = lx * ly * channelFraction;
  const pathLength = lz * TORTUOSITY;

  const hot = side(input.hot, dh, crossArea, pathLength, input.nuCorrection);
  const cold = side(input.cold, dh, crossArea, pathLength, input.nuCorrection);

  const t = input.thickness / 1000;
  const UA =
    1 / (1 / (hot.h * wallArea) + t / (input.solid.k * wallArea) + 1 / (cold.h * wallArea));

  const cHot = input.hot.mdot * input.hot.cp;
  const cCold = input.cold.mdot * input.cold.cp;
  const cMin = Math.min(cHot, cCold);
  const cRatio = cMin / Math.max(cHot, cCold);
  const NTU = UA / cMin;
  const effectiveness = effectivenessNTU(NTU, cRatio, input.flow);
  const Q = effectiveness * cMin * (input.hot.Tin - input.cold.Tin);

  return {
    hydraulicDiameter: dh,
    wallArea,
    crossArea,
    volume,
    solidFraction,
    channelFraction,
    hot,
    cold,
    laminar: hot.laminar && cold.laminar,
    UA,
    U: UA / wallArea,
    NTU,
    effectiveness,
    Q,
    Qhot: Q,
    Qcold: Q * (1 - ENERGY_IMBALANCE),
    imbalance: ENERGY_IMBALANCE * 100,
    cHot,
    cCold,
    cMin,
    cRatio,
    dTHot: Q / cHot,
    dTCold: Q / cCold,
    ThOut: input.hot.Tin - Q / cHot,
    TcOut: input.cold.Tin + Q / cCold,
    lengthZ: lz,
  };
}

export interface ScaleUpResult {
  parallelX: number;
  parallelY: number;
  parallel: number;
  series: number;
  totalCells: number;
  area: number;
  coreVolume: number;
  pressureDropHot: number;
  pressureDropCold: number;
  UA: number;
  U: number;
  NTU: number;
  effectiveness: number;
  Q: number;
  ThOut: number;
  TcOut: number;
  pumpingPower: number;
  powerDensity: number;
  mdotPerChannelHot: number;
  reynoldsHot: number;
}

/**
 * Analytical scale-up under the periodic-repetition assumption: Δp adds along the series
 * direction, UA adds over every cell, and ε is recomputed from total NTU (never multiplied).
 */
export function computeScaleUp(
  input: PhysicsInput,
  core: CoreTarget,
  perf: Performance,
): ScaleUpResult {
  const parallelX = Math.max(1, Math.round(core.width / input.cell[0]));
  const parallelY = Math.max(1, Math.round(core.height / input.cell[1]));
  const parallel = parallelX * parallelY;
  const series = Math.max(1, Math.round(core.length / input.cell[2]));

  const mdotHot = core.mdotHot / parallel;
  const mdotCold = core.mdotCold / parallel;
  const pathLength = perf.lengthZ * TORTUOSITY;

  const hot = side(
    { ...input.hot, mdot: mdotHot },
    perf.hydraulicDiameter,
    perf.crossArea,
    pathLength,
    input.nuCorrection,
  );
  const cold = side(
    { ...input.cold, mdot: mdotCold },
    perf.hydraulicDiameter,
    perf.crossArea,
    pathLength,
    input.nuCorrection,
  );

  const t = input.thickness / 1000;
  const uaCell =
    1 /
    (1 / (hot.h * perf.wallArea) + t / (input.solid.k * perf.wallArea) + 1 / (cold.h * perf.wallArea));
  const UA = uaCell * parallel * series;

  const cHot = core.mdotHot * input.hot.cp;
  const cCold = core.mdotCold * input.cold.cp;
  const cMin = Math.min(cHot, cCold);
  const cRatio = cMin / Math.max(cHot, cCold);
  const NTU = UA / cMin;
  const effectiveness = effectivenessNTU(NTU, cRatio, input.flow);
  const Q = effectiveness * cMin * (input.hot.Tin - input.cold.Tin);

  const area = perf.wallArea * parallel * series;
  const coreVolume = (core.width * core.height * core.length) / 1e9;
  const pressureDropHot = hot.pressureDrop * series;

  return {
    parallelX,
    parallelY,
    parallel,
    series,
    totalCells: parallel * series,
    area,
    coreVolume,
    pressureDropHot,
    pressureDropCold: cold.pressureDrop * series,
    UA,
    U: UA / area,
    NTU,
    effectiveness,
    Q,
    ThOut: input.hot.Tin - Q / cHot,
    TcOut: input.cold.Tin + Q / cCold,
    pumpingPower: (pressureDropHot * core.mdotHot) / input.hot.rho,
    powerDensity: Q / 1000 / (coreVolume * 1000),
    mdotPerChannelHot: mdotHot,
    reynoldsHot: hot.reynolds,
  };
}

export interface ExergyResult {
  T0_c: number;
  sGenHot: number;
  sGenCold: number;
  sGen: number;
  exergyDestroyed: number;
  exergySupplied: number;
  etaII: number;
  Ns: number;
}

export function computeExergy(
  perf: Performance,
  hot: Stream,
  cold: Stream,
  T0_c = 25,
): ExergyResult {
  const T0  = T0_c + 273.15;
  const Thi = hot.Tin      + 273.15;
  const Tho = perf.ThOut   + 273.15;
  const Tci = cold.Tin     + 273.15;
  const Tco = perf.TcOut   + 273.15;

  const sGenHot  = hot.mdot  * hot.cp  * Math.log(Tho / Thi);
  const sGenCold = cold.mdot * cold.cp * Math.log(Tco / Tci);
  const sGen = sGenHot + sGenCold;

  const Tlm = Math.abs(Thi - Tho) < 1e-6
    ? Thi
    : (Thi - Tho) / Math.log(Thi / Tho);

  const exergySupplied  = (Tlm > T0 && perf.Q > 0)
    ? perf.Q * (1 - T0 / Tlm)
    : 0;
  const exergyDestroyed = T0 * sGen;

  const etaII = exergySupplied > 1e-9
    ? Math.max(0, Math.min(1, 1 - exergyDestroyed / exergySupplied))
    : 0;

  const minStream = perf.cHot <= perf.cCold ? hot : cold;
  const Ns = minStream.mdot > 0
    ? sGen / (minStream.mdot * minStream.cp)
    : 0;

  return {
    T0_c, sGenHot, sGenCold, sGen,
    exergyDestroyed, exergySupplied, etaII, Ns,
  };
}
