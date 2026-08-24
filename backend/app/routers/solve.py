"""WS /solve — real CFD residual stream.

Client sends one JSON config message to start:
    {"maxIterations": 2000, "residualTarget": 1e-4}
Optionally also the full case spec (surface/cellX/cellY/cellZ/thickness/
grading/faces/hot/cold/solid, same shape as WS /mesh-independence's config) —
a converged real run then logs its solved performance to
services/design_history.py (see _run_real below); omit it and solving still
works identically, just without that side effect.
Server streams one JSON message per iteration:
    {"iteration": int, "residuals": {"ux": f, "p": f, "hHot": f, "hCold": f, "hSolid": f},
     "converged": bool | null, "jobStatus": "running" | "done" | "failed", "source": "openfoam" | "synthetic"}
until convergence, the iteration cap, or the socket closes.

Runs the real solver subprocess (parsing its stdout for residuals) against
whichever case this session's `?session=` id last meshed (see
services/job_state.py) when the solver and a meshed case are both
available; falls back to the synthetic decay model (same shape as
hooks/useSolver.ts) otherwise, exactly like the front end's own fallback
behaviour.
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from ..schemas import SolvedFieldRequest, SolvedFieldResponse
from ..services import design_history, job_state
from ..services.foam import openfoam_available
from ..services.foam_field import FieldUnavailable, sample_field
from ..services.foam_metrics import solved_performance
from ..services.foam_solve import run_real_solve
from ..services.queue import solve_queue

router = APIRouter(tags=["solve"])
logger = logging.getLogger(__name__)

DECAY = {"ux": 150, "p": 110, "hHot": 190, "hCold": 185, "hSolid": 340}
START = {"ux": 0.9, "p": 1.0, "hHot": 0.6, "hCold": 0.55, "hSolid": 0.5}


async def _run_synthetic(ws: WebSocket, max_iterations: int, target: float) -> None:
    iteration = 0
    while True:
        await asyncio.sleep(0.15)
        iteration += 12

        residuals = {
            key: START[key] * math.exp(-iteration / tau) * (0.7 + random.random() * 0.6)
            for key, tau in DECAY.items()
        }
        converged = all(v < target for v in residuals.values())
        stop = converged or iteration >= max_iterations

        await ws.send_json(
            {
                "iteration": iteration,
                "residuals": residuals,
                "converged": converged if stop else None,
                "jobStatus": "done" if stop and converged else "failed" if stop else "running",
                "source": "synthetic",
            }
        )
        if stop:
            break


async def _run_real(ws: WebSocket, case_dir: Path, max_iterations: int, target: float, case_config: dict | None) -> None:
    """Streams services.foam_solve.run_real_solve's messages straight to this
    one connection — the actual subprocess/parsing logic lives there now so
    the mesh-independence study (routers/mesh_independence.py) can run the
    exact same real solve loop once per resolution level.

    If the caller included the full case spec on its start message (`faces`/
    `hot`/`cold`/`solid`/geometry — optional, older clients can omit it and
    solving still works exactly as before), a converged run's real
    solved-field performance is both logged to services/design_history.py
    (the same training data services/surrogate.py's quick-estimate feature
    reads from) and sent to the client as one extra {"stage": "performance",
    ...} message after the final residual message — the only place this data
    (e.g. solidTminC/solidTmaxC) reaches the live UI; before this it was
    computed and then discarded. Best-effort: a failure here (e.g. the
    solved field not being available for some reason) is logged, not raised
    — a missing history entry or missing performance message is not a solve
    failure, the solve itself already succeeded and was already reported."""
    last: dict | None = None
    async for msg in run_real_solve(case_dir, max_iterations, target):
        await ws.send_json(msg)
        last = msg

    if (
        last is not None
        and last.get("jobStatus") == "done"
        and last.get("converged")
        and case_config is not None
        and all(k in case_config for k in ("surface", "faces", "hot", "cold", "solid", "cellX", "cellY", "cellZ", "thickness", "grading"))
    ):
        try:
            performance = solved_performance(case_dir, case_config["faces"], case_config["hot"], case_config["cold"])
            params = design_history.build_params(
                cellX=case_config["cellX"], cellY=case_config["cellY"], cellZ=case_config["cellZ"],
                thickness=case_config["thickness"], grading=case_config["grading"],
                hot=case_config["hot"], cold=case_config["cold"], solid=case_config["solid"],
            )
            design_history.record(case_config["surface"], params, performance, origin="solve")
            await ws.send_json({"stage": "performance", **performance})
        except Exception:
            logger.exception("failed to record/send solved performance after converged solve")


@router.websocket("/solve")
async def solve(ws: WebSocket) -> None:
    await ws.accept()
    try:
        config = await ws.receive_json()
        # Fallback only used if the caller omits maxIterations entirely (the
        # frontend always sends its own, currently defaulted to 2000 — see
        # useAppStore.ts — since hSolid needs real headroom to converge).
        max_iterations = int(config.get("maxIterations", 2000))
        target = float(config.get("residualTarget", 1e-4))

        state = job_state.get_session(ws.query_params.get("session"))
        case_dir = state.active_case_dir
        if case_dir is not None and openfoam_available():
            async with solve_queue.slot(ws.send_json):
                await _run_real(ws, case_dir, max_iterations, target, config)
        else:
            await _run_synthetic(ws, max_iterations, target)
    except WebSocketDisconnect:
        return


@router.post("/solve/field", response_model=SolvedFieldResponse)
def solved_field(req: SolvedFieldRequest, session: str | None = Query(None)) -> SolvedFieldResponse:
    """Samples a real solved field (temperature/velocity/pressure) onto the
    caller's own surface points via nearest-cell-centre lookup — see
    services/foam_field.py for why nearest-cell rather than interpolation.
    409 if this session has no solved case yet (or the solver isn't
    available); 422 if the requested region/field combination has no real
    solved data (e.g. velocity in the solid region) — the front end is
    expected to fall back to the analytical preview in both cases."""
    state = job_state.get_session(session)
    case_dir = state.active_case_dir
    if case_dir is None or not openfoam_available():
        raise HTTPException(status_code=409, detail="no solved case available – mesh and solve first")

    points_mm = np.array(req.positions, dtype=np.float64).reshape(-1, 3)
    points_m = points_mm / 1000.0

    try:
        values, lo, hi = sample_field(case_dir, req.region, req.field, points_m)
    except FieldUnavailable as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return SolvedFieldResponse(values=values.tolist(), min=lo, max=hi, source="openfoam")
