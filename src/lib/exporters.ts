function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  download(filename, new Blob([text], { type: mime }));
}

/** Writes a binary STL directly from the extracted triangle soup. */
export function exportSTL(
  filename: string,
  positions: Float32Array,
  indices: number[],
): number {
  const triangles = indices.length / 3;
  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles, true);

  let o = 84;
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

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    view.setFloat32(o, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);
    o += 12;

    for (const k of [a, b, c]) {
      view.setFloat32(o, positions[k], true);
      view.setFloat32(o + 4, positions[k + 1], true);
      view.setFloat32(o + 8, positions[k + 2], true);
      o += 12;
    }

    view.setUint16(o, 0, true);
    o += 2;
  }

  download(filename, new Blob([buffer], { type: 'model/stl' }));
  return triangles;
}

/** Writes a plain-text Wavefront OBJ — universally supported, a safe fallback to STL. */
export function exportOBJ(filename: string, positions: Float32Array, indices: number[]): number {
  const lines: string[] = ['# Fluetix — triangulated lattice wall'];
  const vcount = positions.length / 3;
  for (let i = 0; i < vcount; i++) {
    lines.push('v ' + positions[i * 3] + ' ' + positions[i * 3 + 1] + ' ' + positions[i * 3 + 2]);
  }
  for (let i = 0; i < indices.length; i += 3) {
    lines.push('f ' + (indices[i] + 1) + ' ' + (indices[i + 1] + 1) + ' ' + (indices[i + 2] + 1));
  }
  downloadText(filename, lines.join('\n'), 'model/obj');
  return indices.length / 3;
}

export interface StepMeta {
  caseName: string;
  surface: string;
  cell: [number, number, number];
  thickness: number;
  triangles: number;
  vertices: number;
}

/**
 * Tessellated B-Rep STEP header. TPMS surfaces are not NURBS-representable, so the real
 * back end writes faceted geometry through OpenCASCADE — faceting is expected, not a defect.
 */
export function buildStepFile(meta: StepMeta): string {
  const lines = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('TPMS lattice wall — tessellated B-Rep'),'2;1');",
    "FILE_NAME('" +
      meta.caseName +
      ".step','" +
      new Date().toISOString() +
      "',('Fluetix'),(''),'1.0','Fluetix','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    '/* ' + meta.triangles + ' triangular faces, ' + meta.vertices + ' vertices */',
    '/* surface: ' +
      meta.surface +
      '  cell ' +
      meta.cell.join(' x ') +
      ' mm  wall ' +
      meta.thickness +
      ' mm */',
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ];
  return lines.join('\n');
}

/** Flattens a nested report object into two-column CSV. */
export function toCSV(source: Record<string, unknown>): string {
  const rows: string[][] = [['key', 'value']];
  const walk = (prefix: string, value: unknown): void => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(prefix ? prefix + '.' + k : k, v);
      }
    } else {
      rows.push([prefix, Array.isArray(value) ? value.join(' ') : String(value)]);
    }
  };
  walk('', source);
  return rows.map((r) => r.join(',')).join('\n');
}
