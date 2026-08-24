import { create } from 'zustand';
import { FLUIDS, SOLIDS } from '../lib/presets';
import { detectFlowArrangement } from '../lib/flow';
import { evaluateFluid } from '../lib/fluidProperties';
import { evaluateSolid } from '../lib/solidProperties';
import { VOXELS_PREVIEW, type LatticeParams } from '../lib/tpms';
import { fetchProperties, type FluidListEntry, type HealthReport } from '../lib/api';
import type { Performance } from '../lib/physics';
import {
  buildProjectFile,
  downloadProjectFile,
  projectFileToPatch,
  readProjectFile,
  ProjectFileError,
  type ProjectFile,
} from '../lib/projectFile';
import type {
  Axis,
  BusyState,
  ClipAxis,
  CoreTarget,
  CustomFluid,
  CustomSolid,
  ExplorerState,
  ExportFormat,
  FaceKey,
  FaceRole,
  FieldName,
  FlowArrangement,
  GeometryMode,
  GeometryStats,
  ImportedPart,
  JobStatus,
  LogLine,
  MeshIndependenceState,
  MeshStats,
  NuCorrectionParams,
  ProbeResult,
  QuickEstimateState,
  Quality,
  RegionKey,
  SolidMaterial,
  SolvedPerformance,
  Stream,
  SurfaceType,
  TurbulenceModel,
  UncertaintyState,
  WatertightReport,
} from '../lib/types';

export interface AppState {
  /* shell */
  step: number;
  panelOpen: boolean;
  panelWidth: number;
  focusMode: boolean;
  aboutOpen: boolean;
  commandPaletteOpen: boolean;
  toast: string | null;
  /** Mobile remote-control feature (see hooks/useRemoteControl.ts) — `enabled`
   *  drives the WS connection lifecycle independent of whether the pairing
   *  modal is currently shown, so closing the QR modal after pairing doesn't
   *  drop the phone's control session. */
  remoteControlEnabled: boolean;
  remoteControlModalOpen: boolean;
  remotePhoneConnected: boolean;
  busy: BusyState | null;
  caseName: string;
  /** Display-only preference: everything is still stored/computed in Celsius
   *  internally (lib/fluidProperties.ts and every physics calc), this only
   *  controls how temperatures are shown and edited in the UI — see
   *  lib/utils.ts's toDisplayTemp/fromDisplayTemp. Session-only, not
   *  persisted to the project file or localStorage. */
  tempUnit: 'C' | 'K';

  /* phase 1 — lattice */
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
  stats: GeometryStats;
  exportFormat: ExportFormat;
  /** Last generated params/resolution — geometry only rebuilds when Generate is clicked. */
  activeParams: LatticeParams;
  activeVoxels: number;
  generating: boolean;

  /* phase 2 — regions */
  mode: GeometryMode;
  imported: ImportedPart | null;
  faces: Record<FaceKey, FaceRole>;
  flow: FlowArrangement;
  filled: boolean;
  watertight: WatertightReport | null;
  regionVisibility: Record<RegionKey, boolean>;
  regionOpacity: Record<RegionKey, number>;
  regionColor: Record<RegionKey, string>;

  /* phase 3 — case */
  hot: Stream;
  cold: Stream;
  solid: SolidMaterial;
  /** Wall reference temperature the built-in alloys' k/cp are evaluated at —
   *  see lib/solidProperties.ts. Ignored by custom-saved and manually-edited solids. */
  solidRefTempC: number;
  materialFavorites: string[];
  materialRecents: string[];
  /** Full CoolProp fluid list from GET /fluids (~136 real equations of state) —
   *  empty until the backend answers; the UI falls back to the 5 built-in
   *  presets in lib/presets.ts until then. */
  fluidCatalog: FluidListEntry[];
  /** User-saved materials — a snapshot of the values at save time, not a live
   *  equation of state, so they work identically with or without a backend
   *  and travel with the project file. */
  customFluids: Record<string, CustomFluid>;
  customSolids: Record<string, CustomSolid>;
  nuCorrection: NuCorrectionParams;
  setNuCorrection: (params: NuCorrectionParams) => void;
  deadStateT: number;
  setDeadStateT: (t: number) => void;

  /* phase 4 — mesh & solve */
  bgCells: number;
  refine: number;
  layers: number;
  meshed: boolean;
  mesh: MeshStats | null;
  turbulence: TurbulenceModel;
  residualTarget: string;
  maxIterations: number;
  solving: boolean;
  iteration: number;
  residuals: { ux: number[]; p: number[]; hHot: number[]; hCold: number[]; hSolid: number[] };
  converged: boolean | null;

  /* phase 5 — scale-up */
  core: CoreTarget;
  meshIndependence: MeshIndependenceState;
  reportGenerating: boolean;

  /* design-exploration features — see backend/app/services/design_history.py */
  quickEstimate: QuickEstimateState;
  uncertainty: UncertaintyState;
  explorer: ExplorerState;

  /* results view */
  viewRegion: RegionKey;
  viewField: FieldName;
  clip: number;
  clipAxis: ClipAxis;
  clipNormal: [number, number, number];
  probe: ProbeResult | null;
  contourRange: { min: number; max: number } | null;
  /** 'solved' requires solvedFieldReady — see useSolver.ts for when that
   *  flips true/false (a real, completed WS /solve; cleared by a new mesh
   *  or a new solve run so stale data is never silently shown). */
  contourSource: 'analytical' | 'solved';
  solvedFieldReady: boolean;
  /** Real solved-field-derived performance (solid T min/max, energy balance,
   *  etc.) sent once after a converged real solve — see useSolver.ts's
   *  handling of WS /solve's "performance" message. Distinct from
   *  `backendPerformance` below, which is the analytical ε-NTU cross-check,
   *  not a solved-field result. Null until a real solve has completed. */
  backendSolvedPerformance: SolvedPerformance | null;
  /** True while hooks/useLatticeGeometry.ts's solved-field fetch is in
   *  flight — the first request per region/time can take a few real
   *  seconds (it runs an OpenFOAM postProcess subprocess server-side), so
   *  the legend shows this rather than silently keeping stale colours up. */
  fetchingSolvedField: boolean;

  /* phase 6 — jobs */
  jobStatus: JobStatus;
  jobLog: LogLine[];
  /** Live shared-backend load — polled while the backend is available (see
   *  hooks/useQueueStatus.ts); drives the header's execution-status indicator
   *  and the Mesh & Solve step's backend-status panel. */
  queueStatus: { running: number; waiting: number; maxConcurrent: number; sessions: number } | null;

  /* imperative viewport commands */
  viewCommand: { dir: [number, number, number]; id: number } | null;

  /** Optional FastAPI backend (see /backend). Checked once at startup; every
   *  call site falls back to the in-browser stand-in when this is false. */
  backend: { available: boolean; checking: boolean; detail: HealthReport | null };
  /** Cross-check from POST /cases + GET /results — same ε-NTU math as lib/physics.ts,
   *  computed server-side, so this should track `performance` almost exactly. */
  backendPerformance: Performance | null;

  /* actions */
  set: (patch: Partial<AppState>) => void;
  setStep: (step: number) => void;
  setLattice: (patch: Partial<AppState>) => void;
  setStream: (key: 'hot' | 'cold', patch: Partial<Stream>) => void;
  setStreamTemperature: (key: 'hot' | 'cold', tempC: number) => void;
  applyFluidPreset: (key: 'hot' | 'cold', preset: string) => void;
  applySolidPreset: (preset: string) => void;
  setSolidRefTemp: (tempC: number) => void;
  noteMaterialUsed: (key: string) => void;
  toggleMaterialFavorite: (key: string) => void;
  setFluidCatalog: (list: FluidListEntry[]) => void;
  saveCustomFluid: (key: 'hot' | 'cold', name: string) => void;
  saveCustomSolid: (name: string) => void;
  deleteCustomFluid: (key: string) => void;
  deleteCustomSolid: (key: string) => void;
  setFace: (face: FaceKey, role: FaceRole) => void;
  requestViewDir: (dir: [number, number, number]) => void;
  pushLog: (text: string, tone?: LogLine['tone']) => void;
  flash: (message: string) => void;
  exportProjectFile: () => void;
  importProjectFile: (file: File) => Promise<void>;
  duplicateCase: () => void;
  setPanelWidth: (width: number) => void;
  toggleFocusMode: () => void;
  startNewCase: () => void;
}

const water = FLUIDS.water;

const initialParams: LatticeParams = {
  surface: 'gyroid',
  cellX: 8,
  cellY: 8,
  cellZ: 8,
  thickness: 0.6,
  grading: 0,
  gradAxis: 'z',
  nx: 1,
  ny: 1,
  nz: 1,
};

let toastTimer: number | undefined;
const propertyUpgradeTimers: Partial<Record<'hot' | 'cold', number>> = {};

/** OpenFOAM's p_rgh/p fields (see backend/app/services/foam_case.py) are set up as
 *  gauge-plus-atmospheric, so the same conversion is used here to evaluate fluid
 *  properties at the stream's actual absolute operating pressure, not a fixed 1 atm. */
function absolutePressurePa(pOutGaugePa: number): number {
  return 101325 + pOutGaugePa;
}

/** Debounced backend upgrade: correlation values already applied synchronously
 *  by the caller, this just swaps in real CoolProp values (at the stream's actual
 *  T *and* P) a moment later when the backend is reachable — never blocks the
 *  slider/dropdown that called it. */
function scheduleBackendPropertyUpgrade(key: 'hot' | 'cold', fluid: string, tempC: number, pressurePa: number) {
  if (!useAppStore.getState().backend.available) return;
  window.clearTimeout(propertyUpgradeTimers[key]);
  propertyUpgradeTimers[key] = window.setTimeout(async () => {
    try {
      const props = await fetchProperties(fluid, tempC, pressurePa);
      const current = useAppStore.getState()[key];
      if (current.fluid !== fluid || current.Tin !== tempC || absolutePressurePa(current.pOut) !== pressurePa) return; // stale by the time it resolved
      useAppStore.getState().set({ [key]: { ...current, rho: props.rho, mu: props.mu, cp: props.cp, k: props.k } } as unknown as Partial<AppState>);
    } catch {
      // backend flaked mid-session — the correlation value already applied stays in place
    }
  }, 250);
}

export const useAppStore = create<AppState>((set, get) => ({
  step: 0,
  panelOpen: true,
  panelWidth: Number(window.localStorage.getItem('hx.panelWidth')) || 356,
  focusMode: false,
  aboutOpen: false,
  commandPaletteOpen: false,
  remoteControlEnabled: false,
  remoteControlModalOpen: false,
  remotePhoneConnected: false,
  toast: null,
  busy: null,
  caseName: 'untitled-case-01',
  tempUnit: 'C',

  surface: initialParams.surface,
  cellX: initialParams.cellX,
  cellY: initialParams.cellY,
  cellZ: initialParams.cellZ,
  thickness: initialParams.thickness,
  grading: initialParams.grading,
  gradAxis: initialParams.gradAxis,
  nx: initialParams.nx,
  ny: initialParams.ny,
  nz: initialParams.nz,
  quality: 'preview',
  stats: { triangles: 0, vertices: 0, solidFraction: 0, specificArea: 0, ms: 0 },
  exportFormat: 'stl',
  activeParams: initialParams,
  activeVoxels: VOXELS_PREVIEW,
  generating: false,

  mode: 'unitcell',
  imported: null,
  faces: {
    'X-': 'inletHot',
    'X+': 'outletHot',
    'Y-': 'inletCold',
    'Y+': 'outletCold',
    'Z-': 'periodicA',
    'Z+': 'periodicB',
  },
  flow: 'cross',
  filled: false,
  watertight: null,
  regionVisibility: { solid: true, hot: true, cold: true },
  regionOpacity: { solid: 1, hot: 0.35, cold: 0.35 },
  regionColor: { solid: '#c9ced4', hot: '#e2603f', cold: '#4aa8d8' },

  hot: { fluid: 'water', rho: water.rho, mu: water.mu, cp: water.cp, k: water.k, mdot: 0.008, Tin: 80, pOut: 0 },
  cold: { fluid: 'water', rho: water.rho, mu: water.mu, cp: water.cp, k: water.k, mdot: 0.008, Tin: 20, pOut: 0 },
  solid: { mat: 'alsi10mg', k: 130, rho: 2670, cp: 940 },
  solidRefTempC: 100,
  materialFavorites: ['water', 'air'],
  materialRecents: [],
  fluidCatalog: [],
  customFluids: {},
  customSolids: {},
  nuCorrection: {
    A: 0.089,
    b: 0.50,
    sourceNote: 'Default – edit A and b to match your geometry',
  },
  deadStateT: 25,

  bgCells: 24,
  refine: 2,
  layers: 3,
  meshed: false,
  mesh: null,
  turbulence: 'auto',
  residualTarget: '1e-5',
  // 1200 wasn't enough headroom now that "converged" honestly requires the
  // solid region's own residual too (see hSolid) -- a thin, highly-
  // conductive solid wall has a low Biot number and settles far slower than
  // the fluid side, confirmed still expanding at iteration 1236 in a real
  // run. 2000 gives realistic odds of actually reaching the target instead
  // of always hitting this cap.
  maxIterations: 2000,
  solving: false,
  iteration: 0,
  residuals: { ux: [], p: [], hHot: [], hCold: [], hSolid: [] },
  converged: null,

  core: { width: 150, height: 150, length: 300, mdotHot: 0.5, mdotCold: 0.5 },
  meshIndependence: {
    running: false,
    phase: 'idle',
    levelTotal: 0,
    levels: [],
    results: [],
    convergence: null,
    error: null,
    gciRows: null,
  },
  reportGenerating: false,

  quickEstimate: { loading: false, result: null, unavailableReason: null },
  uncertainty: { running: false, phase: 'idle', currentVariant: null, variants: [], bands: null, error: null },
  explorer: { running: false, phase: 'idle', poolSize: 0, screened: false, total: 0, currentIndex: null, candidates: [], error: null },

  viewRegion: 'solid',
  viewField: 'temperature',
  clip: 1,
  clipAxis: 'z',
  clipNormal: [0, 0, 1],
  probe: null,
  contourRange: null,
  contourSource: 'analytical',
  solvedFieldReady: false,
  backendSolvedPerformance: null,
  fetchingSolvedField: false,

  jobStatus: 'idle',
  jobLog: [],
  queueStatus: null,

  backend: { available: false, checking: false, detail: null },
  backendPerformance: null,

  viewCommand: null,

  set: (patch) => set(patch),

  setStep: (step) => set({ step, probe: null }),

  /** Draft parameter edit — geometry itself only rebuilds when Generate is clicked. */
  setLattice: (patch) => set(patch),

  setStream: (key, patch) => {
    const current = get()[key];
    const next = { ...current, ...patch };
    set({ [key]: next, converged: null } as unknown as Partial<AppState>);
    // A pOut edit changes the stream's actual operating pressure, which — for a
    // real CoolProp-backed fluid — changes rho/mu/cp/k too (most visibly for
    // gases). Custom-saved and manual-override fluids are fixed snapshots, not
    // re-evaluated against any equation of state, so they're left alone.
    if ('pOut' in patch && !get().customFluids[current.fluid] && current.fluid !== 'custom') {
      scheduleBackendPropertyUpgrade(key, current.fluid, next.Tin, absolutePressurePa(next.pOut));
    }
  },

  setStreamTemperature: (key, tempC) => {
    const current = get()[key];
    const custom = get().customFluids[current.fluid];
    if (custom) {
      // A saved custom material is a fixed snapshot — only Tin moves, the
      // property values stay exactly what was captured when it was saved.
      set({ [key]: { ...current, Tin: tempC }, converged: null } as unknown as Partial<AppState>);
      return;
    }
    const props = evaluateFluid(current.fluid, tempC);
    const next: Stream = props ? { ...current, Tin: tempC, ...props } : { ...current, Tin: tempC };
    set({ [key]: next, converged: null } as unknown as Partial<AppState>);
    scheduleBackendPropertyUpgrade(key, current.fluid, tempC, absolutePressurePa(current.pOut));
  },

  applyFluidPreset: (key, preset) => {
    const current = get()[key];
    const custom = get().customFluids[preset];
    if (custom) {
      set({
        [key]: { ...current, fluid: preset, rho: custom.rho, mu: custom.mu, cp: custom.cp, k: custom.k },
        converged: null,
      } as unknown as Partial<AppState>);
      get().noteMaterialUsed(preset);
      return;
    }
    const p = FLUIDS[preset];
    const props = evaluateFluid(preset, current.Tin);
    // p is undefined for any fluid outside the 5 legacy presets (the other ~130+
    // from GET /fluids) — evaluateFluid() doesn't know those either (it's a
    // client-side instant-preview correlation covering only the legacy 5), so
    // this keeps the stream's current values as a placeholder until the
    // backend upgrade below lands moments later.
    const fallback = p ? { rho: p.rho, mu: p.mu, cp: p.cp, k: p.k } : { rho: current.rho, mu: current.mu, cp: current.cp, k: current.k };
    const next: Stream =
      preset === 'custom' ? { ...current, fluid: preset } : { ...current, fluid: preset, ...(props ?? fallback) };
    set({ [key]: next, converged: null } as unknown as Partial<AppState>);
    get().noteMaterialUsed(preset);
    if (preset !== 'custom') scheduleBackendPropertyUpgrade(key, preset, current.Tin, absolutePressurePa(current.pOut));
  },

  applySolidPreset: (preset) => {
    const custom = get().customSolids[preset];
    if (custom) {
      set({ solid: { mat: preset, k: custom.k, rho: custom.rho, cp: custom.cp }, converged: null });
      get().noteMaterialUsed(preset);
      return;
    }
    const p = SOLIDS[preset];
    const t = get().solidRefTempC;
    const evaluated = evaluateSolid(preset, t);
    set({
      solid: { mat: preset, k: evaluated?.k ?? p.k, rho: p.rho, cp: evaluated?.cp ?? p.cp },
      converged: null,
    });
    get().noteMaterialUsed(preset);
  },

  setSolidRefTemp: (tempC) => {
    const s = get();
    const evaluated = evaluateSolid(s.solid.mat, tempC);
    set({
      solidRefTempC: tempC,
      ...(evaluated ? { solid: { ...s.solid, k: evaluated.k, cp: evaluated.cp } } : {}),
      converged: null,
    });
  },

  noteMaterialUsed: (key) =>
    set({ materialRecents: [key, ...get().materialRecents.filter((k) => k !== key)].slice(0, 5) }),

  toggleMaterialFavorite: (key) => {
    const cur = get().materialFavorites;
    set({ materialFavorites: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] });
  },

  setFluidCatalog: (list) => set({ fluidCatalog: list }),

  /** Snapshots the given stream's current ρ/μ/cₚ/k under a new name — not a live
   *  equation of state, so it works identically offline and travels with the
   *  project file (see lib/projectFile.ts). */
  saveCustomFluid: (key, name) => {
    const s = get();
    const label = name.trim();
    if (!label) return;
    const slug = 'custom:' + label.toLowerCase().replace(/\s+/g, '-');
    const stream = s[key];
    set({
      customFluids: {
        ...s.customFluids,
        [slug]: { label, rho: stream.rho, mu: stream.mu, cp: stream.cp, k: stream.k, refTempC: stream.Tin },
      },
    });
    s.flash('Saved "' + label + '" – pick it from the material list any time');
  },

  saveCustomSolid: (name) => {
    const s = get();
    const label = name.trim();
    if (!label) return;
    const slug = 'custom:' + label.toLowerCase().replace(/\s+/g, '-');
    set({
      customSolids: {
        ...s.customSolids,
        [slug]: { label, k: s.solid.k, rho: s.solid.rho, cp: s.solid.cp },
      },
    });
    s.flash('Saved "' + label + '" – pick it from the material list any time');
  },

  deleteCustomFluid: (key) => {
    const next = { ...get().customFluids };
    delete next[key];
    set({ customFluids: next });
  },

  deleteCustomSolid: (key) => {
    const next = { ...get().customSolids };
    delete next[key];
    set({ customSolids: next });
  },

  setNuCorrection: (params) => set({ nuCorrection: params }),

  setDeadStateT: (t) => set({ deadStateT: t }),

  setFace: (face, role) => {
    const faces = { ...get().faces, [face]: role };
    const detected = detectFlowArrangement(faces);
    set({ faces, meshed: false, ...(detected ? { flow: detected, converged: null } : {}) });
  },

  requestViewDir: (dir) => set({ viewCommand: { dir, id: Date.now() } }),

  pushLog: (text, tone = 'info') =>
    set({
      jobLog: [...get().jobLog, { text: '[' + new Date().toLocaleTimeString('en-GB') + '] ' + text, tone }].slice(-60),
    }),

  flash: (message) => {
    set({ toast: message });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => set({ toast: null }), 2400);
  },

  exportProjectFile: () => {
    const s = get();
    downloadProjectFile(buildProjectFile(s));
    s.flash('Project saved to disk');
  },

  importProjectFile: async (file) => {
    const s = get();
    let project: ProjectFile;
    try {
      project = await readProjectFile(file);
    } catch (e) {
      s.flash(e instanceof ProjectFileError ? e.message : 'Could not read project file');
      return;
    }
    // Loading someone else's file always starts fresh at Geometry, regardless of
    // what step this project file's own case last left off on.
    set({ ...projectFileToPatch(project), step: 0 } as unknown as Partial<AppState>);
    s.flash('Project loaded – re-run Mesh & Solve to get results');
  },

  setPanelWidth: (width) => {
    const clamped = Math.min(560, Math.max(280, width));
    window.localStorage.setItem('hx.panelWidth', String(clamped));
    set({ panelWidth: clamped });
  },

  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  /** Reloads to genuinely-fresh defaults — a full page reload rather than resetting
   *  fields in place so there's no risk of missing one. */
  startNewCase: () => {
    window.location.reload();
  },

  duplicateCase: () => {
    const s = get();
    const next = s.caseName.replace(/-(\d+)$/, (_m, d: string) =>
      '-' + String(Number(d) + 1).padStart(2, '0'),
    );
    set({ caseName: next === s.caseName ? next + '-copy' : next });
    s.flash('Case duplicated');
  },
}));
