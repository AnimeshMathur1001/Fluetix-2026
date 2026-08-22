"""Detects a real OpenFOAM install. When absent, mesh.py / solve.py fall back
to the same synthetic-but-labelled stand-ins the front end already uses
(useTasks.ts / useSolver.ts) so the API contract is usable end-to-end before
OpenFOAM is actually installed on the host running this service.

The packaged Docker image (backend/Dockerfile, FROM opencfd/openfoam-run)
bakes OpenFOAM directly into the same container as this app — confirmed
working: `chtMultiRegionSimpleFoam`/`blockMesh`/`snappyHexMesh` all run as
plain subprocess calls with no WSL/exec bridging, because subprocess.run()
inherits this process's full environment (PATH + LD_LIBRARY_PATH + OpenFOAM's
own vars), which the base image's /openfoam/run entrypoint already set up
before this app started. Case generation + solve streaming (below) still need
writing — /health reporting openFoam:true only proves the binaries run, not
that a case pipeline exists yet."""
from __future__ import annotations

import shutil


def openfoam_available() -> bool:
    return shutil.which("chtMultiRegionSimpleFoam") is not None and shutil.which("snappyHexMesh") is not None


# --- Real integration seam -------------------------------------------------
# Once OpenFOAM is on PATH, wire it up here rather than adding branches in the
# routers:
#
#   def run_snappy_hex_mesh(case_dir: Path, ...) -> MeshStats:
#       subprocess.run(["blockMesh", "-case", case_dir], check=True)
#       subprocess.run(["snappyHexMesh", "-case", case_dir, "-overwrite"], check=True)
#       return parse_checkmesh(subprocess.run(["checkMesh", "-case", case_dir],
#                                              capture_output=True, text=True, check=True).stdout)
#
#   async def stream_cht_solve(case_dir: Path) -> AsyncIterator[dict]:
#       proc = await asyncio.create_subprocess_exec(
#           "chtMultiRegionSimpleFoam", "-case", str(case_dir),
#           stdout=asyncio.subprocess.PIPE,
#       )
#       async for line in proc.stdout:
#           parsed = parse_residual_line(line.decode())  # regex on "Solving for Ux, ... Final residual = X"
#           if parsed:
#               yield parsed
# -----------------------------------------------------------------------
