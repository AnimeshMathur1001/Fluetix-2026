"""Runs a real chtMultiRegionSimpleFoam subprocess and yields one residual
message per iteration, parsed from its stdout. Extracted out of routers/solve.py
so the same real-solve logic can back both WS /solve (streamed straight to
that one connection) and the mesh-independence study (which runs this same
loop once per resolution level, on the same case directory in place).
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import AsyncIterator

from .foam_case import request_final_write, set_max_iterations
from .foam_field import FieldUnavailable, latest_time_dir, read_field

_REGION_RE = re.compile(r"^Solving for (?:fluid|solid) region (\w+)")
_TIME_RE = re.compile(r"^Time = ([\d.]+)")
_UX_RE = re.compile(r"Solving for Ux, Initial residual = ([\d.eE+-]+)")
_P_RE = re.compile(r"Solving for p_rgh, Initial residual = ([\d.eE+-]+)")
_H_RE = re.compile(r"Solving for h, Initial residual = ([\d.eE+-]+)")

# How often (in iterations) to re-probe the solid field on disk once we're
# blocked only on hSolid, and how many consecutive *distinct* writes must
# match before trusting it — see solid_physically_settled() below.
_SOLID_RECHECK_EVERY = 20
_SOLID_STABLE_WRITES_REQUIRED = 2


async def run_real_solve(case_dir: Path, max_iterations: int, target: float) -> AsyncIterator[dict]:
    """Yields {"iteration", "residuals", "converged", "jobStatus", "source"}
    messages, same shape WS /solve has always sent, once per solver
    iteration plus a final "done"/"failed" message. Terminates the subprocess
    (does not let it run to max_iterations) as soon as every tracked residual
    crosses `target`, matching the original WS /solve early-stop behaviour."""
    set_max_iterations(case_dir, max_iterations)
    proc = await asyncio.create_subprocess_exec(
        "chtMultiRegionSimpleFoam",
        "-case",
        str(case_dir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    iteration = 0
    region: str | None = None
    # Seeded at 1.0 (not 0/empty) so every message always carries all five
    # keys, even before the solver has reported one of them this iteration.
    # hSolid tracks the solid region's own energy-equation residual — without
    # it, "converged" was declared purely on fluid residuals while the solid
    # temperature field was still measurably changing many iterations later
    # (confirmed against a real run: solid T range was still expanding at
    # iteration 1236, long after hot/cold had settled to ~1e-8).
    current = {"ux": 1.0, "p": 1.0, "hHot": 1.0, "hCold": 1.0, "hSolid": 1.0}

    # chtMultiRegionSimpleFoam's "Solving for h, Initial residual" for the
    # *solid* region is a known degenerate case with this coupled BC: for a
    # thin, fast-equilibrating wall it can report exactly 1 on every single
    # iteration from the very first one — confirmed by direct reproduction
    # against a real case — even though the solid's actual temperature field
    # is still visibly evolving for a while, and even though this equation's
    # *Final* residual is ~0 every iteration too (the linear solve is
    # trivially satisfied each time; it's the outer SIMPLE loop's real
    # progress this number structurally can't see). Relying on it alone
    # means "converged" would never fire — the solve just burns through
    # every remaining iteration. Once the fluid side has genuinely converged
    # and hSolid is stuck at that degenerate value, fall back to directly
    # comparing the solid field's own min/max between actual disk writes —
    # the only honest signal left that the solid has truly stopped moving.
    solid_last_time_dir: str | None = None
    solid_last_snapshot: tuple[float, float] | None = None
    solid_stable_writes = 0
    solid_last_probe_iteration = 0

    def solid_physically_settled() -> bool:
        nonlocal solid_last_time_dir, solid_last_snapshot, solid_stable_writes, solid_last_probe_iteration
        if current["hSolid"] < target:
            return True  # not degenerate this run — trust the real residual
        if iteration - solid_last_probe_iteration < _SOLID_RECHECK_EVERY:
            return solid_stable_writes >= _SOLID_STABLE_WRITES_REQUIRED
        solid_last_probe_iteration = iteration
        try:
            time_dir = latest_time_dir(case_dir)
        except FieldUnavailable:
            return False
        if time_dir == solid_last_time_dir:
            # No new write since the last probe — not enough new information
            # to move the streak in either direction yet.
            return solid_stable_writes >= _SOLID_STABLE_WRITES_REQUIRED
        try:
            vals = read_field(case_dir, "solid", time_dir, "temperature")
        except FieldUnavailable:
            return False
        snapshot = (float(vals.min()), float(vals.max()))
        if solid_last_snapshot is not None and all(abs(a - b) < 1e-6 for a, b in zip(snapshot, solid_last_snapshot)):
            solid_stable_writes += 1
        else:
            solid_stable_writes = 0
        solid_last_time_dir = time_dir
        solid_last_snapshot = snapshot
        return solid_stable_writes >= _SOLID_STABLE_WRITES_REQUIRED

    def is_converged() -> bool:
        others = all(current[k] < target for k in ("ux", "p", "hHot", "hCold"))
        return others and (current["hSolid"] < target or solid_physically_settled())

    def message(status: str) -> dict:
        return {
            "iteration": iteration,
            "residuals": dict(current),
            "converged": is_converged() if status != "running" else None,
            "jobStatus": status,
            "source": "openfoam",
        }

    final_write_requested = False
    try:
        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode(errors="replace").strip()

            m = _TIME_RE.match(line)
            if m:
                if iteration > 0:
                    if is_converged() and not final_write_requested:
                        # Ask the running solver to flush its current fields to
                        # disk and stop on its own, instead of being killed
                        # mid-iteration with whatever happened to already be
                        # written (often nothing but the initial `0/` state,
                        # given writeInterval's coarse cadence — see
                        # foam_case.request_final_write). Keep draining stdout
                        # below until it exits by itself; the `finally` block's
                        # terminate/kill stays as the fallback if it doesn't.
                        request_final_write(case_dir, max_iterations)
                        final_write_requested = True
                    yield message("running")
                iteration = int(float(m.group(1)))
                region = None
                continue

            m = _REGION_RE.match(line)
            if m:
                region = m.group(1)
                continue

            m = _UX_RE.search(line)
            if m:
                current["ux"] = float(m.group(1))
                continue

            m = _P_RE.search(line)
            if m:
                # hot's p_rgh is solved before cold's each iteration (region
                # order comes from constant/regionProperties) — average them
                # into one combined pressure-residual metric.
                current["p"] = (current["p"] + float(m.group(1))) / 2 if region == "cold" else float(m.group(1))
                continue

            m = _H_RE.search(line)
            if m and region == "hot":
                current["hHot"] = float(m.group(1))
            elif m and region == "cold":
                current["hCold"] = float(m.group(1))
            elif m and region == "solid":
                current["hSolid"] = float(m.group(1))

        returncode = await proc.wait()
        yield message("done" if returncode == 0 else "failed")
    finally:
        # SIGTERM asks the solver to shut down gracefully, but OpenFOAM traps
        # it and tries to flush its current state — under CPU contention
        # (another concurrent mesh-independence level competing for the same
        # cores) that cleanup can be starved for minutes even though we
        # already have everything we need (the last residual message was
        # already yielded above). Bound the graceful attempt, then SIGKILL,
        # which the kernel reaps without needing the target scheduled at all.
        if proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
