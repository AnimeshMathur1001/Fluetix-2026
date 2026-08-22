import { surfaceNets } from './surfaceNets';
import type { Axis, RegionKey, SurfaceType } from './types';

const TAU = Math.PI * 2;

/**
 * Approximate |grad f| at the zero level set for each surface family. Used to turn a
 * physical wall thickness in mm into a dimensionless iso-offset in field units.
 */
export const GRAD_SCALE: Record<SurfaceType, number> = {
  gyroid: 1.5,
  schwarzp: 1.35,
  diamond: 1.6,
  iwp: 3.0,
};

/** Implicit trigonometric level-set functions, period 2π per unit cell. */
export function tpmsField(type: SurfaceType, x: number, y: number, z: number): number {
  const s = Math.sin;
  const c = Math.cos;
  switch (type) {
    case 'schwarzp':
      return c(x) + c(y) + c(z);
    case 'diamond':
      return s(x) * s(y) * s(z) + s(x) * c(y) * c(z) + c(x) * s(y) * c(z) + c(x) * c(y) * s(z);
    case 'iwp':
      return 2 * (c(x) * c(y) + c(y) * c(z) + c(z) * c(x)) - (c(2 * x) + c(2 * y) + c(2 * z));
    case 'gyroid':
    default:
      return s(x) * c(y) + s(y) * c(z) + s(z) * c(x);
  }
}

export interface LatticeParams {
  surface: SurfaceType;
  cellX: number;
  cellY: number;
  cellZ: number;
  thickness: number;
  grading: number;
  gradAxis: Axis;
  nx: number;
  ny: number;
  nz: number;
}

/** Half wall thickness expressed in field units. */
export function isoOffset(p: LatticeParams): number {
  const a = (p.cellX + p.cellY + p.cellZ) / 3;
  return (p.thickness * Math.PI) / a * GRAD_SCALE[p.surface];
}

export interface ScalarField {
  data: Float32Array;
  dims: [number, number, number];
  solidFraction: number;
}

/**
 * Samples the implicit field over the block. The domain border is forced positive so the
 * extracted surface closes on itself and the result is genuinely watertight.
 */
export function buildScalarField(
  p: LatticeParams,
  region: RegionKey,
  voxelsPerCell: number,
): ScalarField {
  const nx = Math.max(10, Math.round(voxelsPerCell * p.nx));
  const ny = Math.max(10, Math.round(voxelsPerCell * p.ny));
  const nz = Math.max(10, Math.round(voxelsPerCell * p.nz));
  const data = new Float32Array(nx * ny * nz);
  const cBase = isoOffset(p);

  let solid = 0;
  let total = 0;
  let idx = 0;

  for (let k = 0; k < nz; k++) {
    const w = k / (nz - 1);
    const z = TAU * p.nz * w;
    for (let j = 0; j < ny; j++) {
      const v = j / (ny - 1);
      const y = TAU * p.ny * v;
      for (let i = 0; i < nx; i++, idx++) {
        const u = i / (nx - 1);
        const x = TAU * p.nx * u;

        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) {
          data[idx] = 1;
          continue;
        }

        const f = tpmsField(p.surface, x, y, z);
        const g = p.gradAxis === 'x' ? u : p.gradAxis === 'y' ? v : w;
        const c = cBase * (1 + p.grading * (g - 0.5) * 2);

        total++;
        if (Math.abs(f) < c) solid++;

        if (region === 'solid') data[idx] = Math.abs(f) - c;
        else if (region === 'hot') data[idx] = c - f;
        else data[idx] = f + c;
      }
    }
  }

  return { data, dims: [nx, ny, nz], solidFraction: total ? solid / total : 0 };
}

export interface LatticeMeshData {
  positions: Float32Array;
  indices: number[];
  triangles: number;
  vertices: number;
  solidFraction: number;
  /** m² per m³ of block volume. */
  specificArea: number;
  box: [number, number, number];
  ms: number;
}

/** Builds the triangulated region boundary in millimetres, centred on the origin. */
export function buildLattice(
  p: LatticeParams,
  region: RegionKey,
  voxelsPerCell: number,
): LatticeMeshData {
  const t0 = performance.now();
  const field = buildScalarField(p, region, voxelsPerCell);
  const { positions: raw, indices } = surfaceNets(field.data, field.dims);

  const lx = p.cellX * p.nx;
  const ly = p.cellY * p.ny;
  const lz = p.cellZ * p.nz;
  const [dx, dy, dz] = field.dims;

  // Voxel index i corresponds to physical fraction i/(n-1) (see buildScalarField's own
  // u = i / (nx - 1)), spanning the full [0, n-1] index range including the
  // forced-outside border shell at 0 and n-1 -- NOT [0, n-2]. Dividing by (dx - 2) here
  // previously mapped index dx-2 to the box's +edge exactly while the mirror vertex near
  // index 1 landed well short of the -edge, an asymmetric bounding box.
  const positions = new Float32Array(raw.length * 3);
  for (let i = 0; i < raw.length; i++) {
    positions[i * 3] = (raw[i][0] / (dx - 1)) * lx - lx / 2;
    positions[i * 3 + 1] = (raw[i][1] / (dy - 1)) * ly - ly / 2;
    positions[i * 3 + 2] = (raw[i][2] / (dz - 1)) * lz - lz / 2;
  }

  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    area += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
  }

  return {
    positions,
    indices,
    triangles: indices.length / 3,
    vertices: raw.length,
    solidFraction: field.solidFraction,
    specificArea: (area / (lx * ly * lz)) * 1000,
    box: [lx, ly, lz],
    ms: Math.round(performance.now() - t0),
  };
}

export const VOXELS_PREVIEW = 30;
export const VOXELS_FULL = 56;
/** Hard ceiling on total sample count so a 10×10×10-cell assembly can't hang the tab. */
export const MAX_VOXEL_SAMPLES = 4_000_000;

/** Scales voxel resolution down as the assembly grows so generation stays interactive. */
export function adaptiveVoxelsPerCell(nx: number, ny: number, nz: number, voxelsPerCell: number): number {
  const total = Math.pow(voxelsPerCell, 3) * nx * ny * nz;
  if (total <= MAX_VOXEL_SAMPLES) return voxelsPerCell;
  const scale = Math.cbrt(MAX_VOXEL_SAMPLES / total);
  return Math.max(8, Math.round(voxelsPerCell * scale));
}

/** Rough pre-generation estimate for the UI — surface nets triangle count scales with the
 *  number of grid cells the isosurface crosses, roughly O(voxelsPerCell²) per unit cell. */
export function estimateTriangles(p: LatticeParams, voxelsPerCell: number): number {
  return Math.round(p.nx * p.ny * p.nz * voxelsPerCell * voxelsPerCell * 5);
}

/** Approximate GPU/CPU buffer memory for the estimated triangle count. */
export function estimateMemoryMB(triangles: number): number {
  return (triangles * 60) / 1e6;
}
