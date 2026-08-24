"""WS /mesh-independence — a genuine grid-convergence study, not a
placeholder. Distinct from the periodicity/block-independence check, which
used to have a POST /sweep stub here returning hardcoded numbers and has
since been removed entirely rather than kept as a fake result. This reruns
the *same* real mesh+solve pipeline that /mesh and WS /solve already use,
once per requested background-mesh resolution (`bgCells`), and reports how a
solved-field-derived metric (pressure drop, effectiveness) changes as the
mesh gets finer — the standard way to check a CFD result isn't an artifact of
mesh coarseness.

Client sends one JSON config message to start:
    {"meshLevels": [16, 20, 24], "maxIterations": 2000, "residualTarget": 1e-4,
     "surface", "cellX", "cellY", "cellZ", "thickness", "grading", "gradAxis",
     "faces", "hot", "cold", "solid": <same shape as POST /mesh's MeshRequest>}
Server streams JSON messages (interleaved across levels — see below):
    {"phase": "meshing", "level": int, "index": int, "total": int}
    {"phase": "meshed", "level": int, "cells": int, "hot": int, "cold": int, "solid": int}
    {"phase": "solving", "level": int, "iteration": int, "residuals": {...}, "converged": bool|null}
    {"phase": "level_done", "level": int, "cells": int, "performance": {...solved_performance...}}
    {"phase": "failed", "level": int, "error": str}
    {"phase": "complete", "levels": [...level_done payloads, sorted by level...], "convergence": {...}}

Every level gets its own subdirectory under this session's case dir (not one
shared directory taking turns) so levels can genuinely run at once rather
than strictly one-after-another — bounded by the same shared job queue
(services/queue.py) that governs every other mesh/solve request on this
server, so N levels of one study compete fairly with everyone else's jobs
instead of monopolising the machine. Leaves job_state pointing at the FINEST
level's case directory when done — consistent with the rest of the app
treating "the current case" as the one most recently (re)meshed.
"""
from __future__ import annotations

import asyncio
import shutil

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services import design_history, job_state
from ..services.foam_case import MeshPipelineError, generate_case, run_mesh_pipeline
from ..services.foam_field import FieldUnavailable
from ..services.foam_metrics import solved_performance
from ..services.foam_solve import run_real_solve
from ..services.queue import mesh_queue

router = APIRouter(tags=["mesh-independence"])

# Metrics tracked for the final convergence table — chosen because they're
# the ones a real design decision (pump sizing, effectiveness target) would
# actually hinge on, not because they're the only ones available.
_TRACKED = [("hot", "pressureDrop"), ("cold", "pressureDrop"), ("effectiveness", None)]


def _tracked_value(perf: dict, region: str, key: str | None) -> float:
    return perf[region] if key is None else perf[region][key]


def _convergence_table(levels: list[dict]) -> dict:
    """% change in each tracked metric between consecutive resolution
    levels — the standard grid-convergence signal: shrinking % change as the
    mesh refines means the result is becoming mesh-independent, not still an
    artifact of how coarse the mesh is."""
    import math as _math

    rows = []
    for region, key in _TRACKED:
        name = region if key is None else f"{region}.{key}"
        values = [
            _tracked_value(lv["performance"], region, key)
            for lv in levels
        ]
        cell_counts = [lv["cells"] for lv in levels]

        deltas = []
        for i in range(1, len(values)):
            prev, cur = values[i - 1], values[i]
            deltas.append(
                abs(cur - prev) / abs(prev) * 100 if prev else 0.0
            )

        gci = None
        if len(values) >= 3:
            n1 = cell_counts[-1]
            n2 = cell_counts[-2]
            n3 = cell_counts[-3]
            f1 = values[-1]
            f2 = values[-2]
            f3 = values[-3]
            eps21 = f2 - f1
            eps32 = f3 - f2
            try:
                r21 = (n1 / n2) ** (1.0 / 3.0)
                r32 = (n2 / n3) ** (1.0 / 3.0)
                if (r21 > 1.0 and r32 > 1.0
                        and abs(eps21) > 1e-12
                        and abs(eps32) > 1e-12
                        and (eps32 / eps21) > 0):
                    p = (abs(_math.log(abs(eps32 / eps21)))
                         / _math.log(r21))
                    if p > 0:
                        f_ext = f1 + (f1 - f2) / (r21 ** p - 1)
                        e_ext = (
                            abs((f_ext - f1) / f_ext) * 100
                            if f_ext else 0.0
                        )
                        gci_fine = (
                            1.25 * abs(eps21 / f1)
                            / (r21 ** p - 1) * 100
                            if f1 else 0.0
                        )
                        gci = {
                            "observedOrder": round(p, 3),
                            "fineGridValue": round(f1, 6),
                            "richardsonExtrapolated": round(f_ext, 6),
                            "extrapolatedErrorPct": round(e_ext, 3),
                            "gciFineGridPct": round(gci_fine, 3),
                            "r21": round(r21, 4),
                            "r32": round(r32, 4),
                            "converged": gci_fine < 2.0,
                        }
            except (ValueError, ZeroDivisionError, OverflowError):
                gci = None

        rows.append({
            "metric": name,
            "values": values,
            "cellCounts": cell_counts,
            "percentChange": deltas,
            "gci": gci,
        })
    return {"rows": rows}


@router.websocket("/mesh-independence")
async def mesh_independence(ws: WebSocket) -> None:
    await ws.accept()
    # Every level runs concurrently (bounded by mesh_queue) and streams onto
    # this one connection — a lock keeps their interleaved sends from
    # corrupting each other, since Starlette's WebSocket.send_json isn't
    # safe to call from multiple tasks at once without one.
    send_lock = asyncio.Lock()

    async def safe_send(payload: dict) -> None:
        async with send_lock:
            await ws.send_json(payload)

    try:
        config = await ws.receive_json()
        levels: list[int] = sorted({int(v) for v in config["meshLevels"]})
        max_iterations = int(config.get("maxIterations", 2000))
        target = float(config.get("residualTarget", 1e-4))
        faces = config["faces"]
        hot, cold, solid = config["hot"], config["cold"], config["solid"]

        state = job_state.get_session(ws.query_params.get("session"))

        if not state.mesh_lock.acquire(blocking=False):
            await safe_send({"phase": "failed", "level": None, "error": "A mesh generation is already running for this case – wait for it to finish."})
            return

        async def run_level(index: int, bg_cells: int) -> dict | None:
            level_dir = state.case_dir / f"level-{bg_cells}"
            await safe_send({"phase": "meshing", "level": bg_cells, "index": index, "total": len(levels)})

            async with mesh_queue.slot(safe_send):
                if level_dir.exists():
                    shutil.rmtree(level_dir)

                try:
                    generate_case(
                        case_dir=level_dir,
                        surface=config["surface"],
                        cell=(config["cellX"], config["cellY"], config["cellZ"]),
                        n=(config["nx"], config["ny"], config["nz"]),
                        thickness=config["thickness"],
                        grading=config["grading"],
                        grad_axis=config["gradAxis"],
                        faces=faces,
                        hot=hot,
                        cold=cold,
                        solid=solid,
                        bg_cells=bg_cells,
                        stl_voxels=48,
                        max_iterations=1,
                    )
                    mesh_stats = run_mesh_pipeline(level_dir)
                except MeshPipelineError as exc:
                    await safe_send({"phase": "failed", "level": bg_cells, "error": f"{exc.step} failed – see server logs"})
                    return None

                await safe_send({"phase": "meshed", "level": bg_cells, **mesh_stats})

                async for msg in run_real_solve(level_dir, max_iterations, target):
                    await safe_send({"phase": "solving", "level": bg_cells, **msg})

                try:
                    performance = solved_performance(level_dir, faces, hot, cold)
                except FieldUnavailable as exc:
                    await safe_send({"phase": "failed", "level": bg_cells, "error": str(exc)})
                    return None

                # Every resolution level is a genuine real solve at the case's
                # actual (unperturbed) geometry — free extra training data for
                # services/surrogate.py's quick-estimate feature.
                params = design_history.build_params(
                    cellX=config["cellX"], cellY=config["cellY"], cellZ=config["cellZ"],
                    thickness=config["thickness"], grading=config["grading"], hot=hot, cold=cold, solid=solid,
                )
                design_history.record(config["surface"], params, performance, origin="mesh-independence")

            level_result = {"level": bg_cells, "cells": mesh_stats["cells"], "performance": performance}
            await safe_send({"phase": "level_done", **level_result})
            return level_result

        try:
            results = await asyncio.gather(*(run_level(i, bg) for i, bg in enumerate(levels)))
            completed = [r for r in results if r is not None]
            if len(completed) != len(levels):
                return  # one level already sent its own "failed" message — don't also claim completion

            completed.sort(key=lambda r: r["level"])

            # This study's final case dir belongs to its own finest-level params,
            # not necessarily whatever /mesh last cached under last_mesh_key — so
            # a later unrelated /mesh request can't wrongly cache-hit against it.
            state.active_case_dir = state.case_dir / f"level-{levels[-1]}"
            state.last_mesh_key = None
            await safe_send({"phase": "complete", "levels": completed, "convergence": _convergence_table(completed)})
        finally:
            state.mesh_lock.release()
    except WebSocketDisconnect:
        return
