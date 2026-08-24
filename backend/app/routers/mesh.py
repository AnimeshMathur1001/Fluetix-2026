import hashlib
import json
import shutil
import sys

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ..schemas import MeshRequest, MeshResponse, WatertightRequest, WatertightResponse
from ..services import job_state
from ..services.foam import openfoam_available
from ..services.foam_case import MeshPipelineError, generate_case, run_mesh_pipeline, run_mesh_pipeline_streamed
from ..services.job_state import SessionState
from ..services.queue import mesh_queue
from ..services.watertight import check_watertight

router = APIRouter(tags=["mesh"])

# marching-cubes voxel density for the per-region STL export. 48 is the
# resolution proven to keep thin walls from leaking between cellZones
# (see backend/app/services/foam_case.py's zoning notes) — not yet exposed
# as a tunable, unlike the frontend's own preview/full quality toggle.
STL_VOXELS = 48

_STATS_KEYS = ("cells", "hot", "cold", "solid", "skewness", "aspectRatio", "nonOrthogonality")


@router.post("/validate", response_model=WatertightResponse)
def validate(req: WatertightRequest) -> WatertightResponse:
    """Real check — open-edge / non-manifold-edge / shell-count audit on the
    actual triangulation, no OpenFOAM required. Operates on the positions/
    indices the caller sent, not a stored case, so it needs no session."""
    return WatertightResponse(**check_watertight(req.positions, req.indices))


def _synthetic_mesh(req: MeshRequest) -> MeshResponse:
    cells = round((req.bgCells**3) * (1.9**req.refine) * (req.nx * req.ny * req.nz) / 1000)
    return MeshResponse(
        cells=cells,
        hot=round(cells * 0.36),
        cold=round(cells * 0.36),
        solid=round(cells * 0.28),
        skewness=round(1.9 - req.refine * 0.12, 2),
        aspectRatio=6.2,
        nonOrthogonality=round(41 - req.refine * 2, 1),
        source="synthetic",
    )


def _has_full_case_spec(req: MeshRequest) -> bool:
    return None not in (req.surface, req.cellX, req.cellY, req.cellZ, req.thickness, req.grading, req.gradAxis, req.faces, req.hot, req.cold, req.solid)


def mesh_cache_key(req: MeshRequest) -> str:
    """Fingerprints every field that actually affects the generated mesh. An
    unchanged fingerprint means re-running the real mesh pipeline would just
    reproduce the mesh already sitting in this session's case dir — see the
    cache-hit checks in both handlers below."""
    payload = {
        "bgCells": req.bgCells, "refine": req.refine, "layers": req.layers,
        "nx": req.nx, "ny": req.ny, "nz": req.nz,
        "surface": req.surface, "cellX": req.cellX, "cellY": req.cellY, "cellZ": req.cellZ,
        "thickness": req.thickness, "grading": req.grading, "gradAxis": req.gradAxis,
        "faces": req.faces,
        "hot": req.hot.model_dump() if req.hot else None,
        "cold": req.cold.model_dump() if req.cold else None,
        "solid": req.solid.model_dump() if req.solid else None,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def _cache_hit(state: SessionState, key: str) -> dict | None:
    if (
        key == state.last_mesh_key
        and state.last_mesh_stats is not None
        and state.active_case_dir == state.case_dir
        and state.case_dir.exists()
    ):
        return state.last_mesh_stats
    return None


@router.post("/mesh", response_model=MeshResponse)
def mesh(req: MeshRequest, session: str | None = Query(None)) -> MeshResponse:
    """Real mesh pipeline when the backend solver is available and the
    caller sent a full case spec; the synthetic cell-count estimate
    otherwise (no solver, or an older/partial client request) — mirrors the
    front end's own fallback in useTasks.ts. `session` isolates this from
    every other browser session's case dir (see services/job_state.py)."""
    if not openfoam_available() or not _has_full_case_spec(req):
        return _synthetic_mesh(req)

    state = job_state.get_session(session)
    key = mesh_cache_key(req)
    cached = _cache_hit(state, key)
    if cached is not None:
        return MeshResponse(**cached, source="openfoam")

    if not state.mesh_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A mesh generation is already running for this case – wait for it to finish.")
    try:
        if state.case_dir.exists():
            shutil.rmtree(state.case_dir)

        try:
            generate_case(
                case_dir=state.case_dir,
                surface=req.surface,
                cell=(req.cellX, req.cellY, req.cellZ),
                n=(req.nx, req.ny, req.nz),
                thickness=req.thickness,
                grading=req.grading,
                grad_axis=req.gradAxis,
                faces=req.faces,
                hot=req.hot.model_dump(),
                cold=req.cold.model_dump(),
                solid=req.solid.model_dump(),
                bg_cells=req.bgCells,
                stl_voxels=STL_VOXELS,
                # Placeholder — WS /solve rewrites this from the user's actual
                # maxIterations once the solve step starts.
                max_iterations=1,
            )
            stats = run_mesh_pipeline(state.case_dir)
        except MeshPipelineError as exc:
            state.active_case_dir = None
            state.last_mesh_key = None
            print(exc, file=sys.stderr)
            raise HTTPException(status_code=500, detail=f"{exc.step} failed – see server logs") from exc

        state.active_case_dir = state.case_dir
        state.last_mesh_key = key
        state.last_mesh_stats = {k: stats[k] for k in _STATS_KEYS}
        return MeshResponse(**state.last_mesh_stats, source="openfoam")
    finally:
        state.mesh_lock.release()


@router.websocket("/mesh")
async def mesh_ws(ws: WebSocket) -> None:
    """Same pipeline as POST /mesh, but streams one real message per stage
    as it actually starts and finishes, instead of making the caller wait
    for one blocking response — see services/foam_case.py's
    run_mesh_pipeline_streamed and hooks/useTasks.ts for the client side.
    Caller sends `?session=<id>` on the connection URL (see lib/session.ts)
    so this session's case dir never collides with another browser's."""
    await ws.accept()
    try:
        payload = await ws.receive_json()
        req = MeshRequest(**payload)
    except (WebSocketDisconnect, ValidationError):
        return

    state = job_state.get_session(ws.query_params.get("session"))

    if not openfoam_available() or not _has_full_case_spec(req):
        await ws.send_json({**_synthetic_mesh(req).model_dump(), "stage": "complete", "percent": 100, "detail": "estimated – solver unavailable or partial case spec", "jobStatus": "done"})
        return

    key = mesh_cache_key(req)
    cached = _cache_hit(state, key)
    if cached is not None:
        await ws.send_json({**cached, "stage": "complete", "percent": 100, "detail": "unchanged parameters – reusing the existing mesh", "jobStatus": "done", "source": "openfoam"})
        return

    if not state.mesh_lock.acquire(blocking=False):
        await ws.send_json({"stage": "queued", "percent": 0, "detail": "A mesh generation is already running for this case – wait for it to finish, then try again.", "jobStatus": "failed", "source": "openfoam"})
        return

    try:
        async with mesh_queue.slot(ws.send_json):
            if state.case_dir.exists():
                shutil.rmtree(state.case_dir)

            try:
                await ws.send_json({"stage": "geometry", "percent": 3, "detail": "Preparing geometry…", "jobStatus": "running", "source": "openfoam"})
                generate_case(
                    case_dir=state.case_dir,
                    surface=req.surface,
                    cell=(req.cellX, req.cellY, req.cellZ),
                    n=(req.nx, req.ny, req.nz),
                    thickness=req.thickness,
                    grading=req.grading,
                    grad_axis=req.gradAxis,
                    faces=req.faces,
                    hot=req.hot.model_dump(),
                    cold=req.cold.model_dump(),
                    solid=req.solid.model_dump(),
                    bg_cells=req.bgCells,
                    stl_voxels=STL_VOXELS,
                    max_iterations=1,
                )
            except Exception as exc:  # noqa: BLE001 — surface any case-generation failure to the client, not a 500
                state.active_case_dir = None
                state.last_mesh_key = None
                await ws.send_json({"stage": "geometry", "percent": 3, "detail": str(exc), "jobStatus": "failed", "source": "openfoam"})
                return

            try:
                async for msg in run_mesh_pipeline_streamed(state.case_dir):
                    if msg["jobStatus"] == "failed":
                        state.active_case_dir = None
                        state.last_mesh_key = None
                        print(msg["detail"], file=sys.stderr)
                        await ws.send_json(msg)
                        return
                    if msg["jobStatus"] == "done":
                        state.active_case_dir = state.case_dir
                        state.last_mesh_key = key
                        state.last_mesh_stats = {k: msg[k] for k in _STATS_KEYS}
                    await ws.send_json(msg)
            except WebSocketDisconnect:
                return
    finally:
        state.mesh_lock.release()

# A real periodicity / block-independence check (solve a 3x3x3 lattice block
# and compare per-cell averages to a single unit cell) used to have a
# POST /sweep stub here returning hardcoded cells/deltaQ=0/deltaP=0. That
# number was never actually computed from anything, so it was removed rather
# than kept as a placeholder result — building the real multi-region solve
# this needs is future work, not something to fake a response for.
