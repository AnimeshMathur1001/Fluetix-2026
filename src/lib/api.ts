/**
 * Client for the optional FastAPI backend (see /backend). Every export here
 * throws on failure — callers are expected to catch and fall back to the
 * in-browser stand-in (lib/tpms.ts, lib/physics.ts, lib/fluidProperties.ts,
 * hooks/useTasks.ts's synthetic progress), exactly the way the front end
 * already behaves when no backend is configured at all.
 */
import type { LatticeParams, LatticeMeshData } from './tpms';
import type { Axis, FaceKey, FaceRole, FieldName, RegionKey, MeshStats, SolidMaterial, Stream, SurfaceType, WatertightReport, FlowArrangement } from './types';
import type { PhysicsInput, Performance } from './physics';
import type { FluidState } from './fluidProperties';
import { getSessionId } from './session';

export const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000';

const WS_BASE = API_BASE.replace(/^http/, 'ws');

/** Appends this browser's session id as a query param — every endpoint that
 *  touches a case directory takes one (see backend/app/services/job_state.py)
 *  so two different people hitting the same backend never collide. */
function withSession(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return path + sep + 'session=' + encodeURIComponent(getSessionId());
}

export interface HealthReport {
  ok: boolean;
  scikitImage: boolean;
  coolProp: boolean;
  openFoam: boolean;
}

async function req<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const res = await fetch(API_BASE + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status);
  return res.json() as Promise<T>;
}

/** Never throws — used to decide whether to attempt anything else below.
 * Docker Desktop on Windows/Mac routes host->container traffic through an
 * extra network proxy hop, and the first request after the container's been
 * idle has been observed taking 1.1s+ there (subsequent ones are fast) — so
 * this needs real headroom, not just "short", or the app falsely falls back
 * to in-browser mode on an otherwise-healthy backend. */
export async function checkHealth(): Promise<HealthReport | null> {
  try {
    return await req<HealthReport>('/health', { method: 'GET' }, 4000);
  } catch {
    return null;
  }
}

export interface QueueStatus {
  running: number;
  waiting: number;
  maxConcurrent: number;
  sessions: number;
}

/** Real, live load on the shared mesh/solve job queue (see
 *  backend/app/services/queue.py) — never throws, same pattern as checkHealth. */
export async function fetchQueueStatus(): Promise<QueueStatus | null> {
  try {
    return await req<QueueStatus>('/queue-status', { method: 'GET' }, 4000);
  } catch {
    return null;
  }
}

export async function fetchLatticeGeometry(
  params: LatticeParams,
  region: RegionKey,
  voxelsPerCell: number,
): Promise<LatticeMeshData> {
  const body = {
    surface: params.surface,
    cellX: params.cellX,
    cellY: params.cellY,
    cellZ: params.cellZ,
    thickness: params.thickness,
    grading: params.grading,
    gradAxis: params.gradAxis,
    nx: params.nx,
    ny: params.ny,
    nz: params.nz,
    region,
    voxelsPerCell,
  };
  const out = await req<{
    positions: number[];
    indices: number[];
    triangles: number;
    vertices: number;
    solidFraction: number;
    specificArea: number;
    box: [number, number, number];
    ms: number;
  }>('/geometry/lattice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 20000);

  return {
    positions: new Float32Array(out.positions),
    indices: out.indices,
    triangles: out.triangles,
    vertices: out.vertices,
    solidFraction: out.solidFraction,
    specificArea: out.specificArea,
    box: out.box,
    ms: out.ms,
  };
}

export async function fetchWatertight(positions: Float32Array, indices: number[]): Promise<WatertightReport> {
  return req<WatertightReport>(
    '/validate',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ positions: Array.from(positions), indices }) },
    15000,
  );
}

export interface MeshRequestBody {
  bgCells: number;
  refine: number;
  layers: number;
  nx: number;
  ny: number;
  nz: number;
  /** Full case spec, needed to actually generate an OpenFOAM case rather
   * than just size a synthetic cell-count estimate — omit to force the
   * synthetic fallback even when the backend has OpenFOAM available. */
  surface?: SurfaceType;
  cellX?: number;
  cellY?: number;
  cellZ?: number;
  thickness?: number;
  grading?: number;
  gradAxis?: Axis;
  faces?: Record<FaceKey, FaceRole>;
  hot?: Stream;
  cold?: Stream;
  solid?: SolidMaterial;
}

export async function fetchMesh(body: MeshRequestBody): Promise<MeshStats & { source: 'openfoam' | 'synthetic' }> {
  // Meshing a real case (blockMesh + snappyHexMesh + splitMeshRegions) takes
  // longer than the synthetic estimate's near-instant response.
  return req('/mesh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 120000);
}

export async function fetchProperties(fluid: string, tempC: number, pressurePa = 101325): Promise<FluidState & { source: 'coolprop' | 'correlation' }> {
  const qs = new URLSearchParams({ fluid, T: String(tempC), P: String(pressurePa) });
  return req('/properties?' + qs.toString(), { method: 'GET' }, 4000);
}

export interface FluidListEntry {
  key: string;
  label: string;
  source: 'coolprop' | 'correlation';
}

/** Every fluid GET /properties can genuinely evaluate — ~136 real CoolProp
 *  equations of state plus the two legacy blend/correlation entries. */
export async function fetchFluidList(): Promise<FluidListEntry[]> {
  const res = await req<{ fluids: FluidListEntry[] }>('/fluids', { method: 'GET' }, 6000);
  return res.fluids;
}

export async function putCase(caseId: string, input: PhysicsInput & { flow: FlowArrangement }): Promise<void> {
  await req(
    '/cases/' + encodeURIComponent(caseId),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
    8000,
  );
}

export interface SolvedFieldResult {
  values: number[];
  min: number;
  max: number;
  source: 'openfoam';
}

/** Samples a real solved OpenFOAM field onto the caller's own surface
 * points (nearest-cell-centre — see backend/app/services/foam_field.py).
 * `positions` are the same flattened (x,y,z) mm triples already used for
 * /validate, i.e. the frontend's own rendered surface, not anything the
 * backend generated. Throws (never a synthetic fallback shape) — the
 * backend has nothing honest to fall back to for "solved field data" the
 * way it does for mesh stats or residual decay, so callers must catch this
 * and fall back to the analytical contour model themselves. */
export async function fetchSolvedField(
  positions: Float32Array,
  region: RegionKey,
  field: FieldName,
): Promise<SolvedFieldResult> {
  return req(
    withSession('/solve/field'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions: Array.from(positions), region, field }),
    },
    20000,
  );
}

export async function fetchResults(caseId: string): Promise<Performance & { source: 'openfoam' | 'analytical' }> {
  return req('/results/' + encodeURIComponent(caseId), { method: 'GET' }, 8000);
}

export interface SolveMessage {
  iteration: number;
  residuals: { ux: number; p: number; hHot: number; hCold: number; hSolid: number };
  converged: boolean | null;
  jobStatus: 'running' | 'done' | 'failed';
  source: 'openfoam' | 'synthetic';
}

/** Sent once, after the final SolveMessage, only when the client's start
 * message included the full case spec and the run converged for real — see
 * backend/app/routers/solve.py's `_run_real`. Distinguished from SolveMessage
 * (which has no `stage` key) the same way the queue's own `{"stage":
 * "queued", ...}` announcement already is. */
export type SolvePerformanceMessage = { stage: 'performance' } & import('./types').SolvedPerformance;

/** Raw WebSocket to WS /solve — caller sends the start config as the first message. */
export function openSolveSocket(): WebSocket {
  return new WebSocket(WS_BASE + withSession('/solve'));
}

/** One real message per blockMesh/snappyHexMesh/checkMesh/splitMeshRegions
 * stage as it actually starts/finishes — see backend/app/services/foam_case.py's
 * run_mesh_pipeline_streamed. `jobStatus: 'done'` carries the final MeshStats
 * fields inline; `'failed'` carries the captured subprocess output in `detail`. */
export type MeshProgressMessage = {
  stage: string;
  percent: number;
  detail: string;
  jobStatus: 'running' | 'done' | 'failed';
  source: 'openfoam' | 'synthetic';
} & Partial<MeshStats>;

/** Raw WebSocket to WS /mesh — caller sends the same body as fetchMesh() as the first message. */
export function openMeshSocket(): WebSocket {
  return new WebSocket(WS_BASE + withSession('/mesh'));
}

/** Message shapes streamed by WS /mesh-independence — see
 * backend/app/routers/mesh_independence.py's module docstring for the full
 * protocol. Discriminated on `phase`. */
export type MeshIndependenceMessage =
  | { phase: 'meshing'; level: number; index: number; total: number }
  | ({ phase: 'meshed'; level: number } & MeshStats)
  | ({ phase: 'solving'; level: number } & SolveMessage)
  | { phase: 'level_done'; level: number; cells: number; performance: import('./types').SolvedPerformance }
  | { phase: 'failed'; level: number | null; error: string }
  | {
      phase: 'complete';
      levels: { level: number; cells: number; performance: import('./types').SolvedPerformance }[];
      convergence: { rows: import('./types').MeshIndependenceConvergenceRow[] };
    };

export interface MeshIndependenceConfig extends MeshRequestBody {
  meshLevels: number[];
  maxIterations: number;
  residualTarget: number;
}

/** Raw WebSocket to WS /mesh-independence — caller sends the start config
 * (full case spec + meshLevels) as the first message. Requires every
 * `MeshRequestBody` field the real /mesh pipeline needs (faces/hot/cold/solid
 * etc — not optional here the way it is for the synthetic-fallback-capable
 * /mesh, since this study only means anything against the real pipeline). */
export function openMeshIndependenceSocket(): WebSocket {
  return new WebSocket(WS_BASE + withSession('/mesh-independence'));
}

export interface ReportRequestBody {
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
  faces: Record<FaceKey, FaceRole>;
  hot: Stream;
  cold: Stream;
  solid: SolidMaterial;
  flow: FlowArrangement;
  mesh?: MeshStats | null;
  residuals?: Record<string, number[]> | null;
  residualTarget?: number | null;
  iteration?: number | null;
  converged?: boolean | null;
  meshIndependence?: import('./types').MeshIndependenceLevel[] | null;
  meshIndependenceConvergence?: import('./types').MeshIndependenceConvergenceRow[] | null;
  core?: import('./types').CoreTarget | null;
  manufacturability?: import('./manufacturability').ManufacturabilityCheck[] | null;
}

export interface EstimateRequestBody {
  surface: SurfaceType;
  cellX: number;
  cellY: number;
  cellZ: number;
  thickness: number;
  grading: number;
  hot: Stream;
  cold: Stream;
  solid: SolidMaterial;
}

/** Thrown by fetchEstimate for the honest "not enough real history yet" case
 * (backend 409) — distinguished from a generic network/server error so the
 * caller can show the disclosed reason instead of a bare failure message. */
export class EstimateUnavailableError extends Error {}

/** POST /estimate — instant estimate from previously solved cases (see
 * backend/app/services/surrogate.py). */
export async function fetchEstimate(body: EstimateRequestBody): Promise<import('./types').QuickEstimateResult> {
  const res = await fetch(API_BASE + '/estimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });
  if (res.status === 409) {
    const { detail } = (await res.json()) as { detail: string };
    throw new EstimateUnavailableError(detail);
  }
  if (!res.ok) throw new Error('/estimate -> HTTP ' + res.status);
  return res.json();
}

/** Never throws — a small transparency readout ("estimates learn from N
 * previously solved cases"), not core functionality. */
export async function fetchDesignHistoryStats(): Promise<{ total: number; bySurface: Record<string, number> } | null> {
  try {
    return await req('/design-history/stats', { method: 'GET' }, 4000);
  } catch {
    return null;
  }
}

/** Message shapes streamed by WS /uncertainty — see
 * backend/app/routers/uncertainty.py's module docstring for the full protocol. */
export type UncertaintyMessage =
  | { phase: 'meshing'; variant: import('./types').UncertaintyVariant; thickness: number }
  | ({ phase: 'meshed'; variant: import('./types').UncertaintyVariant } & MeshStats)
  | ({ phase: 'solving'; variant: import('./types').UncertaintyVariant } & SolveMessage)
  | { phase: 'variant_done'; variant: import('./types').UncertaintyVariant; thickness: number; performance: import('./types').SolvedPerformance }
  | { phase: 'failed'; variant: import('./types').UncertaintyVariant | null; error: string }
  | { phase: 'complete'; variants: import('./types').UncertaintyVariantResult[]; bands: { rows: import('./types').UncertaintyBandRow[] } };

export interface UncertaintyConfig extends MeshRequestBody {
  thicknessTolerance: number;
  bgCells: number;
  maxIterations: number;
  residualTarget: number;
}

/** Raw WebSocket to WS /uncertainty — caller sends the start config (full
 * case spec + thicknessTolerance) as the first message. */
export function openUncertaintySocket(): WebSocket {
  return new WebSocket(WS_BASE + withSession('/uncertainty'));
}

/** Message shapes streamed by WS /design-explorer — see
 * backend/app/routers/explorer.py's module docstring for the full protocol. */
export type ExplorerMessage =
  | { phase: 'pool'; poolSize: number; screened: boolean }
  | { phase: 'candidate_meshing'; index: number; total: number; thickness: number; cellScale: number }
  | ({ phase: 'candidate_meshed'; index: number } & MeshStats)
  | ({ phase: 'candidate_solving'; index: number } & SolveMessage)
  | (import('./types').ExploreCandidate & { phase: 'candidate_done' })
  | { phase: 'failed'; index: number | null; error: string }
  | { phase: 'complete'; candidates: import('./types').ExploreCandidate[]; screened: boolean };

export interface ExplorerConfig extends MeshRequestBody {
  thicknessRange: [number, number];
  cellScaleRange: [number, number];
  sampleCount: number;
  bgCells: number;
  maxIterations: number;
  residualTarget: number;
}

/** Raw WebSocket to WS /design-explorer — caller sends the start config
 * (full case spec + sweep ranges) as the first message. */
export function openExplorerSocket(): WebSocket {
  return new WebSocket(WS_BASE + withSession('/design-explorer'));
}

/** POST /report — a real multi-page PDF, not JSON, so this bypasses the
 * `req` helper and returns the raw Blob for the caller to download. Report
 * generation re-renders geometry and (if a solve is on record) real
 * contours server-side, so it genuinely can take a while — generous
 * timeout, not a quick round-trip. */
export async function fetchReportPdf(body: ReportRequestBody): Promise<Blob> {
  const res = await fetch(API_BASE + withSession('/report'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error('/report -> HTTP ' + res.status);
  return res.blob();
}
