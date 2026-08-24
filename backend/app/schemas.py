"""Pydantic mirrors of src/lib/types.ts — kept field-for-field identical so the
front end's existing TS interfaces need no renaming when it's pointed here."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

SurfaceType = Literal["gyroid", "schwarzp", "diamond", "iwp"]
RegionKey = Literal["solid", "hot", "cold"]
Axis = Literal["x", "y", "z"]
FlowArrangement = Literal["counter", "parallel", "cross"]
FaceKey = Literal["X-", "X+", "Y-", "Y+", "Z-", "Z+"]
FaceRole = Literal["periodicA", "periodicB", "inletHot", "outletHot", "inletCold", "outletCold", "wall"]
FieldName = Literal["temperature", "velocity", "pressure"]


class LatticeRequest(BaseModel):
    surface: SurfaceType
    cellX: float
    cellY: float
    cellZ: float
    thickness: float
    grading: float
    gradAxis: Axis
    nx: int
    ny: int
    nz: int
    region: RegionKey
    voxelsPerCell: int = 30


class GeometryResponse(BaseModel):
    positions: list[float]
    indices: list[int]
    triangles: int
    vertices: int
    solidFraction: float
    specificArea: float
    box: tuple[float, float, float]
    ms: float


class WatertightRequest(BaseModel):
    positions: list[float]
    indices: list[int]


class WatertightResponse(BaseModel):
    ok: bool
    openEdges: int
    nonManifold: int
    shells: int
    volume: float


class CoreTarget(BaseModel):
    width: float
    height: float
    length: float
    mdotHot: float
    mdotCold: float


class ManufacturabilityCheck(BaseModel):
    label: str
    severity: Literal["ok", "warn", "bad"]
    value: str
    detail: str


class Stream(BaseModel):
    fluid: str
    rho: float
    mu: float
    cp: float
    k: float
    mdot: float
    Tin: float
    pOut: float


class SolidMaterial(BaseModel):
    mat: str
    k: float
    rho: float
    cp: float


class MeshRequest(BaseModel):
    bgCells: int
    refine: int
    layers: int
    nx: int
    ny: int
    nz: int
    # Full case spec — needed to actually generate an OpenFOAM case, not just
    # size a synthetic cell-count estimate. Optional so /mesh can still serve
    # the synthetic fallback when the front end (or an older client) omits
    # them.
    surface: SurfaceType | None = None
    cellX: float | None = None
    cellY: float | None = None
    cellZ: float | None = None
    thickness: float | None = None
    grading: float | None = None
    gradAxis: Axis | None = None
    faces: dict[FaceKey, FaceRole] | None = None
    hot: Stream | None = None
    cold: Stream | None = None
    solid: SolidMaterial | None = None


class MeshResponse(BaseModel):
    cells: int
    hot: int
    cold: int
    solid: int
    skewness: float
    aspectRatio: float
    nonOrthogonality: float
    source: Literal["openfoam", "synthetic"]


class SolvedFieldRequest(BaseModel):
    positions: list[float]  # flattened (x,y,z) triples, millimetres — the frontend's own rendered surface
    region: RegionKey
    field: FieldName


class SolvedFieldResponse(BaseModel):
    values: list[float]
    min: float
    max: float
    source: Literal["openfoam"]


class CaseRequest(BaseModel):
    cell: tuple[float, float, float]
    cells: tuple[int, int, int]
    thickness: float
    solidFraction: float
    specificArea: float
    hot: Stream
    cold: Stream
    solid: SolidMaterial
    flow: FlowArrangement
    nuCorrection: dict | None = None


class SidePerformance(BaseModel):
    velocity: float
    reynolds: float
    prandtl: float
    laminar: bool
    friction: float
    pressureDrop: float
    nusselt: float
    h: float


class Performance(BaseModel):
    hydraulicDiameter: float
    wallArea: float
    crossArea: float
    volume: float
    solidFraction: float
    channelFraction: float
    hot: SidePerformance
    cold: SidePerformance
    laminar: bool
    UA: float
    U: float
    NTU: float
    effectiveness: float
    Q: float
    Qhot: float
    Qcold: float
    imbalance: float
    cHot: float
    cCold: float
    cMin: float
    cRatio: float
    dTHot: float
    dTCold: float
    ThOut: float
    TcOut: float
    lengthZ: float
    source: Literal["openfoam", "analytical"]


class PropertiesResponse(BaseModel):
    rho: float
    mu: float
    cp: float
    k: float
    source: Literal["coolprop", "correlation"]


class FluidListEntry(BaseModel):
    key: str
    label: str
    source: Literal["coolprop", "correlation"]


class FluidListResponse(BaseModel):
    fluids: list[FluidListEntry]


class MeshIndependenceLevel(BaseModel):
    level: int
    cells: int
    performance: dict


class MeshIndependenceConvergenceRow(BaseModel):
    metric: str
    values: list[float]
    percentChange: list[float]


class ReportRequest(BaseModel):
    """Everything needed to build the PDF report. The full case spec is
    required (not optional the way MeshRequest's is) — a report always needs
    real geometry to render, unlike /mesh's synthetic-estimate fallback."""

    caseName: str
    surface: SurfaceType
    cellX: float
    cellY: float
    cellZ: float
    thickness: float
    grading: float
    gradAxis: Axis
    nx: int
    ny: int
    nz: int
    faces: dict[FaceKey, FaceRole]
    hot: Stream
    cold: Stream
    solid: SolidMaterial
    flow: FlowArrangement
    nuCorrection: dict | None = None

    # Real mesh stats from the last POST /mesh the frontend already has on
    # screen — not re-derived here (that would mean re-running the whole
    # mesh pipeline just to write a report about it).
    mesh: dict | None = None

    # Residual history from the last solve (frontend's own s.residuals),
    # rendered into a chart in the report if present.
    residuals: dict[str, list[float]] | None = None
    # The case's actual convergence target (frontend's own s.residualTarget),
    # drawn as the residual chart's dashed line — without this the report
    # can't tell 1e-4 from 1e-6 and would otherwise have to guess.
    residualTarget: float | None = None
    iteration: int | None = None
    converged: bool | None = None

    meshIndependence: list[MeshIndependenceLevel] | None = None
    meshIndependenceConvergence: list[MeshIndependenceConvergenceRow] | None = None

    # Target full-scale core (frontend's Scale-up step) — when present, the
    # report recomputes the parallel x series extrapolation server-side from
    # these raw inputs, same integrity reasoning as the analytical model.
    core: CoreTarget | None = None

    # Manufacturability checks (frontend's lib/manufacturability.ts) — passed
    # through as already-computed results (like mesh stats) rather than
    # re-derived here; the overhang figure in particular depends on the
    # actual generated triangle mesh, which lives client-side.
    manufacturability: list[ManufacturabilityCheck] | None = None


class EstimateRequest(BaseModel):
    """Geometry + fluids only — everything services/surrogate.py's feature
    vector reads. No mesh/solve settings: an estimate is meant to be
    available before either of those has run."""

    surface: SurfaceType
    cellX: float
    cellY: float
    cellZ: float
    thickness: float
    grading: float
    hot: Stream
    cold: Stream
    solid: SolidMaterial


class EstimateResponse(BaseModel):
    effectiveness: float
    pressureDropHot: float
    pressureDropCold: float
    Q: float
    confidence: float
    basedOn: int
    sampleSize: int


class DesignHistoryStats(BaseModel):
    total: int
    bySurface: dict[str, int]
