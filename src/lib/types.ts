export type SurfaceType = 'gyroid' | 'schwarzp' | 'diamond' | 'iwp';
export type RegionKey = 'solid' | 'hot' | 'cold';
export type FieldName = 'temperature' | 'velocity' | 'pressure';
export type Axis = 'x' | 'y' | 'z';
export type ClipAxis = 'x' | 'y' | 'z' | 'custom';
export type GeometryMode = 'unitcell' | 'full';
export type Quality = 'preview' | 'full';
export type FlowArrangement = 'counter' | 'parallel' | 'cross';
export type FaceKey = 'X-' | 'X+' | 'Y-' | 'Y+' | 'Z-' | 'Z+';
export type FaceRole =
  | 'periodicA'
  | 'periodicB'
  | 'inletHot'
  | 'outletHot'
  | 'inletCold'
  | 'outletCold'
  | 'wall';
export type TurbulenceModel = 'auto' | 'laminar' | 'kOmegaSST' | 'kEpsilon';
export type JobStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'local';
export type ExportFormat = 'stl' | 'obj' | 'step';

export interface Stream {
  fluid: string;
  rho: number;
  mu: number;
  cp: number;
  k: number;
  mdot: number;
  Tin: number;
  pOut: number;
}

export interface SolidMaterial {
  mat: string;
  k: number;
  rho: number;
  cp: number;
}

/** User-saved fluid — a snapshot of one Stream's ρ/μ/cₚ/k at the temperature it was
 *  saved at, so it reloads instantly without a fluid name CoolProp needs to recognise. */
export interface CustomFluid {
  label: string;
  rho: number;
  mu: number;
  cp: number;
  k: number;
  refTempC: number;
}

export interface CustomSolid {
  label: string;
  k: number;
  rho: number;
  cp: number;
}

export interface GeometryStats {
  triangles: number;
  vertices: number;
  solidFraction: number;
  specificArea: number;
  ms: number;
}

export interface MeshStats {
  cells: number;
  hot: number;
  cold: number;
  solid: number;
  skewness: number;
  aspectRatio: number;
  nonOrthogonality: number;
}

export interface WatertightReport {
  ok: boolean;
  openEdges: number;
  nonManifold: number;
  shells: number;
  volume: number;
}

export interface Residuals {
  ux: number[];
  p: number[];
  hHot: number[];
  hCold: number[];
  hSolid: number[];
}

export interface ProbeResult {
  x: number;
  y: number;
  z: number;
  T: number;
  p: number;
  u: number;
}

export interface LogLine {
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'error';
}

export interface BusyState {
  label: string;
  percent: number;
  detail: string;
}

/** Real solved-field-derived performance, distinct from the analytical
 * epsilon-NTU model in lib/physics.ts — see backend/app/services/foam_metrics.py. */
export interface SolvedPerformance {
  time: string;
  hot: { TinC: number; ToutC: number; pIn: number; pOut: number; pressureDrop: number; velocityIn: number; velocityOut: number };
  cold: { TinC: number; ToutC: number; pIn: number; pOut: number; pressureDrop: number; velocityIn: number; velocityOut: number };
  Qhot: number;
  Qcold: number;
  Q: number;
  imbalance: number;
  effectiveness: number;
  solidTminC: number;
  solidTmaxC: number;
}

export interface MeshIndependenceLevel {
  level: number;
  cells: number;
  performance: SolvedPerformance;
}

export interface MeshIndependenceConvergenceRow {
  metric: string;
  values: number[];
  cellCounts: number[];
  percentChange: number[];
  gci: {
    observedOrder: number;
    fineGridValue: number;
    richardsonExtrapolated: number;
    extrapolatedErrorPct: number;
    gciFineGridPct: number;
    r21: number;
    r32: number;
    converged: boolean;
  } | null;
}

export interface MeshIndependenceLevelProgress {
  level: number;
  phase: 'meshing' | 'meshed' | 'solving' | 'done' | 'failed';
  iteration: number;
}

export interface MeshIndependenceState {
  running: boolean;
  phase: 'idle' | 'running' | 'complete' | 'failed';
  levelTotal: number;
  levels: MeshIndependenceLevelProgress[];
  results: MeshIndependenceLevel[];
  convergence: { rows: MeshIndependenceConvergenceRow[] } | null;
  error: string | null;
  gciRows: Array<{
    metric: string;
    values: number[];
    cellCounts: number[];
    percentChange: number[];
    gci: {
      observedOrder: number;
      fineGridValue: number;
      richardsonExtrapolated: number;
      extrapolatedErrorPct: number;
      gciFineGridPct: number;
      r21: number;
      r32: number;
      converged: boolean;
    } | null;
  }> | null;
}

export interface ImportedPart {
  name: string;
  size: string;
  kind: string;
}

export interface CoreTarget {
  width: number;
  height: number;
  length: number;
  mdotHot: number;
  mdotCold: number;
}

/** Instant performance estimate from previously solved cases — see
 * backend/app/services/surrogate.py. Not a physics simulation; every input
 * point is a real prior solve. */
export interface QuickEstimateResult {
  effectiveness: number;
  pressureDropHot: number;
  pressureDropCold: number;
  Q: number;
  confidence: number;
  basedOn: number;
  sampleSize: number;
}

export interface QuickEstimateState {
  loading: boolean;
  result: QuickEstimateResult | null;
  /** Set instead of `result` when there isn't enough real history for this
   * surface type yet — shown honestly rather than guessing. */
  unavailableReason: string | null;
}

export type UncertaintyVariant = 'nominal' | 'minus' | 'plus';

export interface UncertaintyVariantResult {
  variant: UncertaintyVariant;
  thickness: number;
  performance: SolvedPerformance;
}

export interface UncertaintyBandRow {
  metric: string;
  nominal: number;
  min: number;
  max: number;
  spreadPercent: number;
}

export interface UncertaintyState {
  running: boolean;
  phase: 'idle' | 'running' | 'complete' | 'failed';
  currentVariant: UncertaintyVariant | null;
  variants: UncertaintyVariantResult[];
  bands: UncertaintyBandRow[] | null;
  error: string | null;
}

export interface ExploreCandidate {
  index: number;
  thickness: number;
  cellScale: number;
  solidFraction: number | null;
  performance: SolvedPerformance;
  paretoFront: boolean;
}

export interface ExplorerState {
  running: boolean;
  phase: 'idle' | 'running' | 'complete' | 'failed';
  poolSize: number;
  screened: boolean;
  total: number;
  currentIndex: number | null;
  candidates: ExploreCandidate[];
  error: string | null;
}

export interface NuCorrectionParams {
  /** Coefficient A in laminar Nusselt correction Nu = 4.36 x A x Re^b */
  A: number;
  /** Exponent b in laminar Nusselt correction Nu = 4.36 x A x Re^b */
  b: number;
  /** Free-text note about calibration source. Appears in PDF report. */
  sourceNote: string;
}

export interface ExergyResult {
  T0_c: number;
  sGenHot: number;
  sGenCold: number;
  sGen: number;
  exergyDestroyed: number;
  exergySupplied: number;
  etaII: number;
  Ns: number;
}

