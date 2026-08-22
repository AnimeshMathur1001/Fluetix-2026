from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .routers import compare, estimate, explorer, geometry, mesh, mesh_independence, properties, remote, report, results, solve, sweep, uncertainty
from .services import job_state, queue
from .services.foam import openfoam_available
from .services.fluid_properties import HAVE_COOLPROP
from .services.tpms import HAVE_SKIMAGE

app = FastAPI(
    title="Fluetix",
    version="0.2.0",
    description=(
        "TPMS lattice heat exchanger design workspace.\n\n"
        "Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.\n"
        "Licensed under the Apache License, Version 2.0 — see LICENSE and NOTICE."
    ),
)

app.add_middleware(
    CORSMiddleware,
    # Vite picks the next free port when 5173 is taken, so match any local dev
    # server rather than hardcoding one port. Also allows any RFC1918 LAN
    # address (10.x, 172.16-31.x, 192.168.x) on any port, since the desktop
    # app itself can be reached that way once the mobile remote-control
    # feature (routers/remote.py) is enabled from another device's browser.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(geometry.router)
app.include_router(mesh.router)
app.include_router(mesh_independence.router)
app.include_router(solve.router)
app.include_router(results.router)
app.include_router(properties.router)
app.include_router(report.router)
app.include_router(remote.router)
app.include_router(estimate.router)
app.include_router(uncertainty.router)
app.include_router(explorer.router)
app.include_router(compare.router)
app.include_router(sweep.router)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "scikitImage": HAVE_SKIMAGE,
        "coolProp": HAVE_COOLPROP,
        "openFoam": openfoam_available(),
    }


@app.get("/queue-status")
def queue_status() -> dict:
    """Real, live state of the shared mesh/solve job queue (services/queue.py)
    plus how many browser sessions currently have a case on this server
    (services/job_state.py) — what the frontend's execution-status indicator
    shows instead of the old decorative local/remote toggle."""
    return {**queue.status(), "sessions": job_state.session_count()}


# Installed (and packaged-for-distribution) builds ship the front end's
# production `npm run build` output alongside the backend at ../../dist —
# mounted last so it only ever catches requests no API route above already
# matched. Absent in a plain source checkout that hasn't been built, in
# which case the front end is expected to be served separately (`npm run
# dev`), same as this project always worked before packaging existed.
_DIST_DIR = Path(__file__).resolve().parent.parent.parent / "dist"
if _DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=_DIST_DIR, html=True), name="frontend")


if __name__ == "__main__":
    # `python -m app.main` — deliberately binds every interface (not just
    # loopback) by default, unlike bare `uvicorn app.main:app`. The mobile
    # remote-control feature (routers/remote.py) needs a phone on the LAN to
    # reach this process directly, and anyone who downloads this project and
    # runs the backend without Docker (whose Dockerfile already does this)
    # shouldn't have to know to pass --host 0.0.0.0 themselves for that to work.
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
