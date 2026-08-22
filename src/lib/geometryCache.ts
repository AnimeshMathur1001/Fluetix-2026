/**
 * Last extracted triangle soup, shared between the viewport and the export flow so the
 * field is only evaluated once per parameter change.
 */
export const geometryCache: { positions: Float32Array; indices: number[] } = {
  positions: new Float32Array(0),
  indices: [],
};
