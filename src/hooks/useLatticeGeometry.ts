import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { buildLattice, type LatticeParams } from '../lib/tpms';
import { buildContours, colorsFromValues } from '../lib/contours';
import { fetchSolvedField } from '../lib/api';
import { geometryCache } from '../lib/geometryCache';
import { useAppStore } from '../store/useAppStore';
import { usePhysics } from './usePhysics';

export interface LatticeGeometry {
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  indices: number[];
  box: [number, number, number];
}

/**
 * Extracts the region boundary for the last GENERATED parameters (store.activeParams) — not
 * the live slider draft. Params only change when the user clicks "Generate geometry"; the
 * region/field selectors on the Results step stay reactive since they just pick which field
 * of the same generated block to show.
 */
export function useLatticeGeometry(): LatticeGeometry {
  const store = useAppStore();
  const { performance: perf } = usePhysics();

  const params = store.activeParams;
  const region = store.step === 4 ? store.viewRegion : 'solid';
  const voxels = store.activeVoxels;

  const built = useMemo(() => buildLattice(params, region, voxels), [params, region, voxels]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
    g.setIndex(built.indices);
    g.computeVertexNormals();
    return g;
  }, [built]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  /* Publish geometry statistics to the shell and cache the mesh for export. */
  useEffect(() => {
    geometryCache.positions = built.positions;
    geometryCache.indices = built.indices;
    useAppStore.getState().set({
      stats: {
        triangles: built.triangles,
        vertices: built.vertices,
        solidFraction: built.solidFraction,
        specificArea: built.specificArea,
        ms: built.ms,
      },
    });
  }, [built]);

  /* Contour colouring, results step only. */
  const showContours = store.step === 4;
  const field = store.viewField;
  const flow = store.flow;
  const hotIn = store.hot.Tin;
  const coldIn = store.cold.Tin;
  const faces = store.faces;
  const contourSource = store.contourSource;
  const solvedFieldReady = store.solvedFieldReady;

  useEffect(() => {
    const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!showContours || !normalAttr) {
      geometry.deleteAttribute('color');
      useAppStore.getState().set({ contourRange: null });
      return;
    }

    if (contourSource === 'solved' && solvedFieldReady) {
      let cancelled = false;
      // The first request per region/time triggers a real OpenFOAM
      // postProcess subprocess server-side (cell-centre extraction) and can
      // take several real seconds — flag it so the UI doesn't look stalled.
      useAppStore.getState().set({ fetchingSolvedField: true });
      fetchSolvedField(built.positions, region, field)
        .then(({ values }) => {
          if (cancelled) return;
          // OpenFOAM's T is Kelvin; every other display of temperature in
          // this app (Tin, wallTemperature, FIELD_LABELS) is Celsius.
          const display = field === 'temperature' ? values.map((v) => v - 273.15) : values;
          const { colors, min, max } = colorsFromValues(display, field);
          geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          useAppStore.getState().set({ contourRange: { min, max }, fetchingSolvedField: false });
        })
        .catch(() => {
          if (cancelled) return;
          // Deliberately does NOT force contourSource back to 'analytical' here:
          // the Results panel already prevents selecting solid+U/p (the one
          // combo the backend 422s on by design) while in solved mode, so a
          // failure reaching here is a real, unexpected error (backend down,
          // case not solved) — flipping the whole toggle out from under the
          // user on every transient failure was surprising and, worse, would
          // silently swap away from a combo that DOES have real data just
          // because a sibling request (e.g. a stale in-flight one for a
          // region/field the user already navigated away from) failed.
          useAppStore.getState().flash('Solved field unavailable for this region/field – check the server log');
          useAppStore.getState().set({ fetchingSolvedField: false });
        });
      return () => {
        cancelled = true;
      };
    }

    useAppStore.getState().set({ fetchingSolvedField: false });
    const { colors, min, max } = buildContours(
      built.positions,
      normalAttr.array as Float32Array,
      params as LatticeParams,
      perf,
      field,
      region,
      flow,
      hotIn,
      coldIn,
      faces,
    );
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    useAppStore.getState().set({ contourRange: { min, max } });
    return undefined;
  }, [geometry, built, params, perf, field, region, flow, hotIn, coldIn, faces, showContours, contourSource, solvedFieldReady]);

  return { geometry, positions: built.positions, indices: built.indices, box: built.box };
}
