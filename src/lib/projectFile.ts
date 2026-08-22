import type {
  Axis,
  CoreTarget,
  CustomFluid,
  CustomSolid,
  ExportFormat,
  FaceKey,
  FaceRole,
  FlowArrangement,
  GeometryMode,
  Quality,
  RegionKey,
  SolidMaterial,
  Stream,
  SurfaceType,
  TurbulenceModel,
} from './types';

/** Bump whenever a field is added/removed/renamed below — importProjectFile()
 *  branches on this so older project files still load with sane fallbacks.
 *  v2 added customFluids/customSolids — a v1 file just loads with both empty. */
export const PROJECT_SCHEMA_VERSION = 2;

/** Input parameters only — mesh/solve results live in a server-side case dir
 *  keyed to this browser session and aren't portable, so they're re-derived
 *  by re-running Mesh & Solve after a load rather than saved here. */
export interface ProjectFile {
  schema: number;
  savedAt: string;
  caseName: string;
  geometry: {
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
    quality: Quality;
    exportFormat: ExportFormat;
    mode: GeometryMode;
  };
  regions: {
    faces: Record<FaceKey, FaceRole>;
    flow: FlowArrangement;
    filled: boolean;
    regionVisibility: Record<RegionKey, boolean>;
    regionOpacity: Record<RegionKey, number>;
    regionColor: Record<RegionKey, string>;
  };
  materials: {
    hot: Stream;
    cold: Stream;
    solid: SolidMaterial;
    solidRefTempC: number;
  };
  /** Custom materials the user saved — included so a shared project file carries them
   *  along too. */
  customFluids: Record<string, CustomFluid>;
  customSolids: Record<string, CustomSolid>;
  meshSolve: {
    bgCells: number;
    refine: number;
    layers: number;
    turbulence: TurbulenceModel;
    residualTarget: string;
    maxIterations: number;
  };
  scaleUp: {
    core: CoreTarget;
  };
}

/** Structural subset of AppState this file's format is built from — kept local (rather than
 *  importing AppState) so useAppStore.ts can import this module without a circular dependency. */
export interface ProjectSourceState {
  caseName: string;
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
  quality: Quality;
  exportFormat: ExportFormat;
  mode: GeometryMode;
  faces: Record<FaceKey, FaceRole>;
  flow: FlowArrangement;
  filled: boolean;
  regionVisibility: Record<RegionKey, boolean>;
  regionOpacity: Record<RegionKey, number>;
  regionColor: Record<RegionKey, string>;
  hot: Stream;
  cold: Stream;
  solid: SolidMaterial;
  solidRefTempC: number;
  customFluids: Record<string, CustomFluid>;
  customSolids: Record<string, CustomSolid>;
  bgCells: number;
  refine: number;
  layers: number;
  turbulence: TurbulenceModel;
  residualTarget: string;
  maxIterations: number;
  core: CoreTarget;
}

export function buildProjectFile(s: ProjectSourceState): ProjectFile {
  return {
    schema: PROJECT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    caseName: s.caseName,
    geometry: {
      surface: s.surface,
      cellX: s.cellX,
      cellY: s.cellY,
      cellZ: s.cellZ,
      thickness: s.thickness,
      grading: s.grading,
      gradAxis: s.gradAxis,
      nx: s.nx,
      ny: s.ny,
      nz: s.nz,
      quality: s.quality,
      exportFormat: s.exportFormat,
      mode: s.mode,
    },
    regions: {
      faces: s.faces,
      flow: s.flow,
      filled: s.filled,
      regionVisibility: s.regionVisibility,
      regionOpacity: s.regionOpacity,
      regionColor: s.regionColor,
    },
    materials: { hot: s.hot, cold: s.cold, solid: s.solid, solidRefTempC: s.solidRefTempC },
    customFluids: s.customFluids,
    customSolids: s.customSolids,
    meshSolve: {
      bgCells: s.bgCells,
      refine: s.refine,
      layers: s.layers,
      turbulence: s.turbulence,
      residualTarget: s.residualTarget,
      maxIterations: s.maxIterations,
    },
    scaleUp: { core: s.core },
  };
}

/** Everything a loaded/restored project file implies about the store, including resetting
 *  mesh/solve results — they're never part of the file (see the ProjectFile doc comment above),
 *  so any previous run's numbers must be cleared rather than left mismatched with the new params. */
export function projectFileToPatch(project: ProjectFile) {
  return {
    caseName: project.caseName,
    ...project.geometry,
    ...project.regions,
    ...project.materials,
    // absent in a v1 file (schema bumped to 2 when these were added) — default
    // to empty rather than wiping out anything the loading browser already had.
    customFluids: project.customFluids ?? {},
    customSolids: project.customSolids ?? {},
    ...project.meshSolve,
    core: project.scaleUp.core,
    meshed: false,
    mesh: null,
    watertight: null,
    converged: null,
    solving: false,
    iteration: 0,
    residuals: { ux: [], p: [], hHot: [], hCold: [], hSolid: [] },
    validation: null,
    blockCheck: null,
    meshIndependence: {
      running: false,
      phase: 'idle' as const,
      levelTotal: 0,
      levels: [],
      results: [],
      convergence: null,
      error: null,
    },
    probe: null,
    contourSource: 'analytical' as const,
    solvedFieldReady: false,
    jobStatus: 'idle' as const,
    jobLog: [],
  };
}

export function projectFileName(caseName: string): string {
  const safe = caseName.trim().replace(/[^a-z0-9._-]+/gi, '-') || 'project';
  return safe + '.hxproj.json';
}

export function downloadProjectFile(project: ProjectFile): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = projectFileName(project.caseName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export class ProjectFileError extends Error {}

/** Throws ProjectFileError on anything that isn't a recognisable project file. */
export function parseProjectFile(raw: string): ProjectFile {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ProjectFileError('Not valid JSON');
  }
  if (typeof data !== 'object' || data === null || !('schema' in data) || !('geometry' in data)) {
    throw new ProjectFileError('Not a recognised project file');
  }
  const project = data as ProjectFile;
  if (typeof project.schema !== 'number' || project.schema > PROJECT_SCHEMA_VERSION) {
    throw new ProjectFileError('Saved by a newer version of this app');
  }
  return project;
}

export function readProjectFile(file: File): Promise<ProjectFile> {
  return file.text().then(parseProjectFile);
}
