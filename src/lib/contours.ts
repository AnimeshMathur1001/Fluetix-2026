import type { Performance } from './physics';
import { inletFlowAxis } from './flow';
import { isoOffset, tpmsField, type LatticeParams } from './tpms';
import type { FaceKey, FaceRole, FieldName, FlowArrangement, RegionKey } from './types';

const AXIS_INDEX: Record<'x' | 'y' | 'z', 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

type Stop = [number, number, number];

const COOL_WARM: Stop[] = [
  [0.16, 0.42, 0.72],
  [0.42, 0.66, 0.84],
  [0.82, 0.82, 0.8],
  [0.88, 0.55, 0.36],
  [0.79, 0.24, 0.16],
];

const VIRIDIS: Stop[] = [
  [0.267, 0.005, 0.329],
  [0.229, 0.322, 0.545],
  [0.128, 0.567, 0.551],
  [0.369, 0.789, 0.383],
  [0.993, 0.906, 0.144],
];

function lerpStops(stops: Stop[], t: number): Stop {
  const c = Math.max(0, Math.min(1, t));
  const f = c * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const k = f - i;
  return [
    stops[i][0] + (stops[i + 1][0] - stops[i][0]) * k,
    stops[i][1] + (stops[i + 1][1] - stops[i][1]) * k,
    stops[i][2] + (stops[i + 1][2] - stops[i][2]) * k,
  ];
}

export const COLOUR_RAMPS: Record<FieldName, string> = {
  temperature: 'linear-gradient(90deg,#2a6bb8,#6ba8d6,#d1d1cc,#e08c5c,#c93d29)',
  velocity: 'linear-gradient(90deg,#440a54,#3a528b,#20918c,#5ec962,#fde725)',
  pressure: 'linear-gradient(90deg,#440a54,#3a528b,#20918c,#5ec962,#fde725)',
};

export const FIELD_LABELS: Record<FieldName, string> = {
  temperature: 'Temperature · °C',
  velocity: 'Velocity magnitude · m/s',
  pressure: 'Pressure · Pa gauge',
};

/**
 * Wall temperature model: axial stream profile plus the through-thickness gradient.
 * hotAxial/coldAxial are each 0 at that stream's own inlet, 1 at its own outlet —
 * independent parameters because cross-flow means hot and cold don't share an axis.
 */
export function wallTemperature(
  params: LatticeParams,
  perf: Performance,
  flow: FlowArrangement,
  hotIn: number,
  coldIn: number,
  f: number,
  hotAxial: number,
  coldAxial: number,
): number {
  const c = Math.max(isoOffset(params), 1e-6);
  const th = hotIn - perf.dTHot * hotAxial;
  const tc = flow === 'counter' ? coldIn + perf.dTCold * (1 - coldAxial) : coldIn + perf.dTCold * coldAxial;
  const mean = (th + tc) / 2;
  return mean + 0.42 * (th - tc) * Math.tanh(f / c);
}

export interface ContourResult {
  colors: Float32Array;
  min: number;
  max: number;
}

/**
 * Per-vertex colouring of the extracted surface. Values are sampled from the analytic
 * field model at the real vertex positions, so contours follow the actual lattice.
 */
export function buildContours(
  positions: Float32Array,
  normals: Float32Array,
  params: LatticeParams,
  perf: Performance,
  field: FieldName,
  region: RegionKey,
  flow: FlowArrangement,
  hotIn: number,
  coldIn: number,
  faces: Record<FaceKey, FaceRole>,
): ContourResult {
  const count = positions.length / 3;
  const values = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const TAU = Math.PI * 2;

  const lx = params.cellX * params.nx;
  const ly = params.cellY * params.ny;
  const lz = params.cellZ * params.nz;

  const hotAxis = inletFlowAxis(faces, 'inletHot');
  const coldAxis = inletFlowAxis(faces, 'inletCold');
  const viewAxis = region === 'cold' ? coldAxis : hotAxis;
  const viewAxisIndex = AXIS_INDEX[viewAxis.axis];

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const norm = [(x + lx / 2) / lx, (y + ly / 2) / ly, (z + lz / 2) / lz];
    const hotAxial = hotAxis.sign > 0 ? norm[AXIS_INDEX[hotAxis.axis]] : 1 - norm[AXIS_INDEX[hotAxis.axis]];
    const coldAxial = coldAxis.sign > 0 ? norm[AXIS_INDEX[coldAxis.axis]] : 1 - norm[AXIS_INDEX[coldAxis.axis]];

    let value: number;

    if (field === 'temperature') {
      const f = tpmsField(params.surface, TAU * params.nx * norm[0], TAU * params.ny * norm[1], TAU * params.nz * norm[2]);
      value = wallTemperature(params, perf, flow, hotIn, coldIn, f, hotAxial, coldAxial);
    } else if (field === 'velocity') {
      // Near-wall velocity scales with how closely the surface aligns with the viewed stream's flow axis.
      const alignment = Math.abs(normals[i * 3 + viewAxisIndex]);
      const bulk = region === 'cold' ? perf.cold.velocity : perf.hot.velocity;
      value = bulk * (1.55 - 1.05 * alignment);
    } else {
      const alignment = normals[i * 3 + viewAxisIndex];
      const dp = region === 'cold' ? perf.cold.pressureDrop : perf.hot.pressureDrop;
      const axial = region === 'cold' ? coldAxial : hotAxial;
      value = dp * (1 - axial) + 0.16 * dp * alignment;
    }

    values[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return colorsFromValues(values, field);
}

/** Colour-maps an arbitrary per-vertex value array — shared by the analytic
 * model above and the real solved-field path (hooks/useSolvedField.ts),
 * which samples OpenFOAM output instead of evaluating a closed-form model. */
export function colorsFromValues(values: ArrayLike<number>, field: FieldName): ContourResult {
  const count = values.length;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  const span = max - min || 1;
  const stops = field === 'temperature' ? COOL_WARM : VIRIDIS;
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const [r, g, b] = lerpStops(stops, (values[i] - min) / span);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  return { colors, min, max };
}
