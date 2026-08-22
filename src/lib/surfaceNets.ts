/**
 * Naive Surface Nets (dual contouring of a sign-changing scalar field).
 *
 * Chosen over classic marching cubes because it produces a manifold quad-derived
 * triangle mesh with far fewer degenerate slivers on thin TPMS sheets, at the same
 * cost. Reference implementation: Mikola Lysenko's isosurface package (MIT).
 */

const CUBE_EDGES = new Int32Array(24);
const EDGE_TABLE = new Int32Array(256);

(function buildTables(): void {
  let k = 0;
  for (let i = 0; i < 8; ++i) {
    for (let j = 1; j <= 4; j <<= 1) {
      const p = i ^ j;
      if (i <= p) {
        CUBE_EDGES[k++] = i;
        CUBE_EDGES[k++] = p;
      }
    }
  }
  for (let i = 0; i < 256; ++i) {
    let mask = 0;
    for (let j = 0; j < 24; j += 2) {
      const a = Boolean(i & (1 << CUBE_EDGES[j]));
      const b = Boolean(i & (1 << CUBE_EDGES[j + 1]));
      mask |= a !== b ? 1 << (j >> 1) : 0;
    }
    EDGE_TABLE[i] = mask;
  }
})();

export interface SurfaceNetsResult {
  /** Vertex positions in voxel index space. */
  positions: number[][];
  /** Flat triangle index list. */
  indices: number[];
}

export function surfaceNets(
  data: Float32Array,
  dims: [number, number, number],
): SurfaceNetsResult {
  const positions: number[][] = [];
  const indices: number[] = [];

  const R: [number, number, number] = [1, dims[0] + 1, (dims[0] + 1) * (dims[1] + 1)];
  const buffer = new Int32Array(R[2] * 2);
  const grid = new Float32Array(8);
  const x: [number, number, number] = [0, 0, 0];

  let n = 0;
  let bufNo = 1;

  for (x[2] = 0; x[2] < dims[2] - 1; ++x[2], n += dims[0], bufNo ^= 1, R[2] = -R[2]) {
    let m = 1 + (dims[0] + 1) * (1 + bufNo * (dims[1] + 1));

    for (x[1] = 0; x[1] < dims[1] - 1; ++x[1], ++n, m += 2) {
      for (x[0] = 0; x[0] < dims[0] - 1; ++x[0], ++n, ++m) {
        let mask = 0;
        let g = 0;
        let idx = n;

        for (let k = 0; k < 2; ++k, idx += dims[0] * (dims[1] - 2)) {
          for (let j = 0; j < 2; ++j, idx += dims[0] - 2) {
            for (let i = 0; i < 2; ++i, ++g, ++idx) {
              const p = data[idx];
              grid[g] = p;
              mask |= p < 0 ? 1 << g : 0;
            }
          }
        }

        if (mask === 0 || mask === 255) continue;

        const edgeMask = EDGE_TABLE[mask];
        const v: [number, number, number] = [0, 0, 0];
        let edgeCount = 0;

        for (let i = 0; i < 12; ++i) {
          if (!(edgeMask & (1 << i))) continue;
          ++edgeCount;

          const e0 = CUBE_EDGES[i << 1];
          const e1 = CUBE_EDGES[(i << 1) + 1];
          const g0 = grid[e0];
          const g1 = grid[e1];
          let t = g0 - g1;

          if (Math.abs(t) > 1e-9) {
            t = g0 / t;
          } else {
            --edgeCount;
            continue;
          }

          for (let j = 0, kk = 1; j < 3; ++j, kk <<= 1) {
            const a = e0 & kk;
            const b = e1 & kk;
            if (a !== b) v[j] += a ? 1.0 - t : t;
            else v[j] += a ? 1.0 : 0;
          }
        }

        if (edgeCount === 0) continue;

        const s = 1.0 / edgeCount;
        for (let i = 0; i < 3; ++i) v[i] = x[i] + s * v[i];

        buffer[m] = positions.length;
        positions.push(v);

        for (let i = 0; i < 3; ++i) {
          if (!(edgeMask & (1 << i))) continue;
          const iu = (i + 1) % 3;
          const iv = (i + 2) % 3;
          if (x[iu] === 0 || x[iv] === 0) continue;

          const du = R[iu];
          const dv = R[iv];

          if (mask & 1) {
            indices.push(buffer[m], buffer[m - du], buffer[m - du - dv]);
            indices.push(buffer[m], buffer[m - du - dv], buffer[m - dv]);
          } else {
            indices.push(buffer[m], buffer[m - dv], buffer[m - du - dv]);
            indices.push(buffer[m], buffer[m - du - dv], buffer[m - du]);
          }
        }
      }
    }
  }

  return { positions, indices };
}
