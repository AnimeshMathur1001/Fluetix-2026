/**
 * TPMS-specific manufacturability checks for powder-bed metal additive
 * manufacturing (LPBF) — a real differentiator for a lattice-focused tool
 * over general-purpose CAD/CFD software, not a decorative checklist.
 *
 * Every number here is either a general, widely-cited LPBF design guideline
 * (wall thickness) or computed directly from the actual generated geometry
 * (overhang area) — nothing is fabricated. Guideline thresholds vary by
 * machine/material/process parameters in practice; treat these as a
 * conservative starting point, not a certified process spec.
 */
import type { FaceKey, FaceRole, RegionKey } from './types';

export type CheckSeverity = 'ok' | 'warn' | 'bad';

export interface ManufacturabilityCheck {
  label: string;
  severity: CheckSeverity;
  value: string;
  detail: string;
}

// Conservative general LPBF guideline for a reliably-printable free-standing
// metal wall — thinner walls are printable on some machines/materials but
// risk warping, porosity, or not fusing cleanly at all. Not material-specific.
const MIN_WALL_MM = 0.3;
const RECOMMENDED_WALL_MM = 0.5;

export function checkWallThickness(thicknessMm: number): ManufacturabilityCheck {
  const severity: CheckSeverity = thicknessMm < MIN_WALL_MM ? 'bad' : thicknessMm < RECOMMENDED_WALL_MM ? 'warn' : 'ok';
  const detail =
    severity === 'bad'
      ? `Below the ${MIN_WALL_MM} mm general LPBF minimum – likely won't fuse cleanly on most machines/materials.`
      : severity === 'warn'
        ? `Printable on many LPBF systems, but below the ${RECOMMENDED_WALL_MM} mm mark generally recommended for a reliable structural wall.`
        : `At or above the ${RECOMMENDED_WALL_MM} mm mark generally recommended for a reliable structural wall.`;
  return { label: 'Wall thickness', severity, value: thicknessMm.toFixed(2) + ' mm', detail };
}

/** A fluid region trapped with no inlet/outlet face becomes a fully enclosed
 *  void in the printed solid — unfused powder inside it has nowhere to drain
 *  out during the build, and it can't be reliably cleaned out afterward. */
export function checkEscapeHoles(faces: Record<FaceKey, FaceRole>): ManufacturabilityCheck[] {
  const regions: { region: RegionKey; roles: FaceRole[] }[] = [
    { region: 'hot', roles: ['inletHot', 'outletHot'] },
    { region: 'cold', roles: ['inletCold', 'outletCold'] },
  ];
  return regions.map(({ region, roles }) => {
    const openFaces = Object.values(faces).filter((r) => (roles as FaceRole[]).includes(r)).length;
    const severity: CheckSeverity = openFaces === 0 ? 'bad' : 'ok';
    const detail =
      openFaces === 0
        ? `No face is tagged inlet/outlet – the ${region} channel has no path to the exterior, so unfused powder can't drain out after printing.`
        : `${openFaces} open face(s) give unfused powder a path out of the ${region} channel during and after the build.`;
    return {
      label: region === 'hot' ? 'Hot channel escape path' : 'Cold channel escape path',
      severity,
      value: openFaces === 0 ? 'sealed' : openFaces + ' open',
      detail,
    };
  });
}

// Standard LPBF self-supporting overhang threshold — surface normals tipped
// more than this many degrees past horizontal (i.e. facing more downward
// than up) typically need support structures or fail to fuse cleanly.
// TPMS surfaces are well known for being largely self-supporting because of
// their continuous curvature, which is exactly what this check verifies
// against the ACTUAL generated geometry rather than assuming it.
const OVERHANG_LIMIT_DEG = 45;

export interface OverhangResult {
  overhangAreaFraction: number;
  totalTriangles: number;
}

/** positions: flat [x,y,z,...] mm; indices: flat [i0,i1,i2,...] triangle indices;
 *  buildAxis: which world axis is "up" (away from the build plate), matching
 *  the printer orientation the part would actually be built in. */
export function computeOverhang(
  positions: Float32Array,
  indices: ArrayLike<number>,
  // 'y' matches this app's own viewport convention (the "top" camera preset
  // looks down the Y axis — see ViewportToolbar.tsx/NavCube.tsx), i.e. Y is
  // "up" here, not the more common Z-up convention.
  buildAxis: 'x' | 'y' | 'z' = 'y',
): OverhangResult {
  const axisIndex = { x: 0, y: 1, z: 2 }[buildAxis];
  const limitCos = Math.cos((90 - OVERHANG_LIMIT_DEG) * (Math.PI / 180)); // normal.z below this = overhanging

  let totalArea = 0;
  let overhangArea = 0;
  const triCount = Math.floor(indices.length / 3);

  const ax = new Float64Array(3);
  const bx = new Float64Array(3);
  const cx = new Float64Array(3);

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    ax[0] = positions[i0]; ax[1] = positions[i0 + 1]; ax[2] = positions[i0 + 2];
    bx[0] = positions[i1]; bx[1] = positions[i1 + 1]; bx[2] = positions[i1 + 2];
    cx[0] = positions[i2]; cx[1] = positions[i2 + 1]; cx[2] = positions[i2 + 2];

    const ux = bx[0] - ax[0], uy = bx[1] - ax[1], uz = bx[2] - ax[2];
    const vx = cx[0] - ax[0], vy = cx[1] - ax[1], vz = cx[2] - ax[2];
    // cross(u, v)
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;

    const area = len / 2;
    totalArea += area;

    const normalUp = [nx / len, ny / len, nz / len][axisIndex];
    // Downward-facing beyond the self-support limit — building overhangs
    // face away from "up" (negative component along the build axis).
    if (-normalUp > limitCos) overhangArea += area;
  }

  return {
    overhangAreaFraction: totalArea > 0 ? overhangArea / totalArea : 0,
    totalTriangles: triCount,
  };
}

export function checkOverhang(result: OverhangResult): ManufacturabilityCheck {
  const pct = result.overhangAreaFraction * 100;
  const severity: CheckSeverity = pct > 15 ? 'bad' : pct > 5 ? 'warn' : 'ok';
  const detail =
    severity === 'ok'
      ? 'The continuous TPMS curvature is doing its job – very little surface needs support.'
      : severity === 'warn'
        ? 'A modest fraction of the surface exceeds the self-supporting angle – likely fine, worth a visual check near thin/graded regions.'
        : 'A significant fraction of the surface exceeds the self-supporting angle – expect support structures or local print defects without design changes (e.g. reduced grading, reoriented build axis).';
  return {
    label: 'Self-supporting surface',
    severity,
    value: pct.toFixed(1) + '% overhanging',
    detail,
  };
}
