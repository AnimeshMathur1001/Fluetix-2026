import type { FaceKey, FaceRole, FlowArrangement } from './types';

const AXIS_OF: Record<FaceKey, { axis: 'x' | 'y' | 'z'; sign: 1 | -1 }> = {
  'X-': { axis: 'x', sign: -1 },
  'X+': { axis: 'x', sign: 1 },
  'Y-': { axis: 'y', sign: -1 },
  'Y+': { axis: 'y', sign: 1 },
  'Z-': { axis: 'z', sign: -1 },
  'Z+': { axis: 'z', sign: 1 },
};

const OUTWARD_NORMAL: Record<FaceKey, [number, number, number]> = {
  'X-': [-1, 0, 0],
  'X+': [1, 0, 0],
  'Y-': [0, -1, 0],
  'Y+': [0, 1, 0],
  'Z-': [0, 0, -1],
  'Z+': [0, 0, 1],
};

function findFace(faces: Record<FaceKey, FaceRole>, role: FaceRole): FaceKey | null {
  const entry = (Object.entries(faces) as [FaceKey, FaceRole][]).find(([, r]) => r === role);
  return entry ? entry[0] : null;
}

/**
 * Determines parallel / counter / cross flow purely from which faces are tagged as the hot
 * and cold inlets — no manual selection. Returns null when either inlet is untagged, in which
 * case the caller should keep the previous value rather than guess.
 */
export function detectFlowArrangement(faces: Record<FaceKey, FaceRole>): FlowArrangement | null {
  const hotIn = findFace(faces, 'inletHot');
  const coldIn = findFace(faces, 'inletCold');
  if (!hotIn || !coldIn) return null;
  const a = AXIS_OF[hotIn];
  const b = AXIS_OF[coldIn];
  if (a.axis !== b.axis) return 'cross';
  return a.sign === b.sign ? 'parallel' : 'counter';
}

/** Direction fluid travels when entering through the given inlet face (into the domain). */
export function inletFlowDirection(faces: Record<FaceKey, FaceRole>, role: 'inletHot' | 'inletCold'): [number, number, number] {
  const key = findFace(faces, role);
  if (!key) return [0, 0, role === 'inletHot' ? 1 : -1];
  const n = OUTWARD_NORMAL[key];
  return [-n[0], -n[1], -n[2]];
}

/**
 * Which axis + sign a stream travels along, from its tagged inlet face. `sign` is the
 * direction of travel (matches inletFlowDirection's non-zero component), not the face's
 * own outward-normal sign. Defaults to +z when the inlet isn't tagged yet.
 */
export function inletFlowAxis(faces: Record<FaceKey, FaceRole>, role: 'inletHot' | 'inletCold'): { axis: 'x' | 'y' | 'z'; sign: 1 | -1 } {
  const key = findFace(faces, role);
  if (!key) return { axis: 'z', sign: 1 };
  const { axis, sign } = AXIS_OF[key];
  return { axis, sign: (sign * -1) as 1 | -1 };
}
