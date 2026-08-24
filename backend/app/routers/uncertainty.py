"""WS /uncertainty — manufacturing-tolerance sensitivity, not the mesh-vs-mesh
question mesh_independence.py answers. Reruns the same real blockMesh ->
snappyHexMesh -> splitMeshRegions -> chtMultiRegionSimpleFoam pipeline three
times at one background-mesh resolution: the case's nominal wall thickness,
and thickness minus/plus a real LPBF dimensional tolerance (the same
guideline src/lib/manufacturability.ts already discloses to the user). The
result is a genuine performance band — "effectiveness lands somewhere in
this real range once the as-printed wall is off by a plausible amount" —
not a single deterministic number pretending the print comes out exact.

Client sends one JSON config message to start:
    {"thicknessTolerance": float (mm), "bgCells": int, "maxIterations": int,
     "residualTarget": float, "surface", "cellX", "cellY", "cellZ",
     "thickness", "grading", "gradAxis", "nx", "ny", "nz",
     "faces", "hot", "cold", "solid": <same shape as POST /mesh's MeshRequest>}
Server streams JSON messages (one variant at a time — see below):
    {"phase": "meshing", "variant": "nominal"|"minus"|"plus", "thickness": float}
    {"phase": "meshed", "variant": str, "cells": int, "hot": int, "cold": int, "solid": int}
    {"phase": "solving", "variant": str, "iteration": int, "residuals": {...}, "converged": bool|null}
    {"phase": "variant_done", "variant": str, "thickness": float, "performance": {...solved_performance...}}
    {"phase": "failed", "variant": str|None, "error": str}
    {"phase": "complete", "variants": [...variant_done payloads...], "bands": {...}}

Variants run one after another (not concurrently, unlike mesh-independence's
levels) — three solves already saturate the shared job queue's usual 2-slot
budget on a small VM, and there's no user-facing "which finishes first"
question here the way there is for independently-meaningful mesh levels.
"""
from __future__ import annotations

import shutil

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services import design_history, job_state
from ..services.foam_case import MeshPipelineError, generate_case, run_mesh_pipeline
from ..services.foam_field import FieldUnavailable
from ..services.foam_metrics import solved_performance
from ..services.foam_solve import run_real_solve
from ..services.queue import mesh_queue

router = APIRouter(tags=["uncertainty"])

# Same three tracked metrics mesh_independence.py's convergence table uses —
# the ones a real design decision (pump sizing, effectiveness target) hinges on.
_TRACKED = [("hot", "pressureDrop"), ("cold", "pressureDrop"), ("effectiveness", None)]


def _tracked_value(perf: dict, region: str, key: str | None) -> float:
    return perf[region] if key is None else perf[region][key]


def _bands(variants: list[dict]) -> dict:
    by_tag = {v["variant"]: v["performance"] for v in variants}
    if "nominal" not in by_tag:
        return {"rows": []}
    rows = []
    for region, key in _TRACKED:
        name = region if key is None else f"{region}.{key}"
        nominal = _tracked_value(by_tag["nominal"], region, key)
        values = [_tracked_value(perf, region, key) for perf in by_tag.values()]
        lo, hi = min(values), max(values)
        spread = (hi - lo) / abs(nominal) * 100 if nominal else 0.0
        rows.append({"metric": name, "nominal": nominal, "min": lo, "max": hi, "spreadPercent": spread})
    return {"rows": rows}


@router.websocket("/uncertainty")
async def uncertainty(ws: WebSocket) -> None:
    await ws.accept()

    try:
        config = await ws.receive_json()
        tolerance = float(config["thicknessTolerance"])
        bg_cells = int(config["bgCells"])
        max_iterations = int(config.get("maxIterations", 2000))
        target = float(config.get("residualTarget", 1e-4))
        surface = config["surface"]
        nominal_thickness = float(config["thickness"])
        faces = config["faces"]
        hot, cold, solid = config["hot"], config["cold"], config["solid"]

        variants = [
            ("nominal", nominal_thickness),
            ("minus", max(0.05, nominal_thickness - tolerance)),
            ("plus", nominal_thickness + tolerance),
        ]

        state = job_state.get_session(ws.query_params.get("session"))
        if not state.mesh_lock.acquire(blocking=False):
            await ws.send_json({"phase": "failed", "variant": None, "error": "A mesh generation is already running for this case – wait for it to finish."})
            return

        completed: list[dict] = []
        try:
            for tag, thickness in variants:
                variant_dir = state.case_dir / f"tolerance-{tag}"
                await ws.send_json({"phase": "meshing", "variant": tag, "thickness": thickness})

                async with mesh_queue.slot(ws.send_json):
                    if variant_dir.exists():
                        shutil.rmtree(variant_dir)

                    try:
                        generate_case(
                            case_dir=variant_dir,
                            surface=surface,
                            cell=(config["cellX"], config["cellY"], config["cellZ"]),
                            n=(config["nx"], config["ny"], config["nz"]),
                            thickness=thickness,
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
                        mesh_stats = run_mesh_pipeline(variant_dir)
                    except MeshPipelineError as exc:
                        await ws.send_json({"phase": "failed", "variant": tag, "error": f"{exc.step} failed – see server logs"})
                        return

                    await ws.send_json({"phase": "meshed", "variant": tag, **mesh_stats})

                    async for msg in run_real_solve(variant_dir, max_iterations, target):
                        await ws.send_json({"phase": "solving", "variant": tag, **msg})

                    try:
                        performance = solved_performance(variant_dir, faces, hot, cold)
                    except FieldUnavailable as exc:
                        await ws.send_json({"phase": "failed", "variant": tag, "error": str(exc)})
                        return

                params = design_history.build_params(
                    cellX=config["cellX"], cellY=config["cellY"], cellZ=config["cellZ"],
                    thickness=thickness, grading=config["grading"], hot=hot, cold=cold, solid=solid,
                )
                design_history.record(surface, params, performance, origin="uncertainty")

                variant_result = {"variant": tag, "thickness": thickness, "performance": performance}
                completed.append(variant_result)
                await ws.send_json({"phase": "variant_done", **variant_result})

            state.active_case_dir = state.case_dir / "tolerance-nominal"
            state.last_mesh_key = None
            await ws.send_json({"phase": "complete", "variants": completed, "bands": _bands(completed)})
        finally:
            state.mesh_lock.release()
    except WebSocketDisconnect:
        return
