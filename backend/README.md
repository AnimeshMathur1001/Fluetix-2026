# Fluetix — backend

FastAPI service implementing the contract described in the front end's
[README § Back-end integration](../README.md#back-end-integration). Verified
working end-to-end (see *What's actually real* below) — this is a scaffold,
not a mockup.

## Run it

**Docker (recommended — includes real OpenFOAM, no manual installs):**

```bash
docker compose up --build   # from the repo root; brings up backend (:8000) + frontend (:5173)
```

`backend/Dockerfile` builds `FROM opencfd/openfoam-run` — real
`chtMultiRegionSimpleFoam`/`snappyHexMesh`/`blockMesh`/`checkMesh`, ~250MB,
confirmed working (see *What's actually real* below). This is what makes the
whole thing packageable: no WSL, no manual OpenFOAM install on the host — the
solver ships inside the image.

**Manual (Python only, no OpenFOAM):**

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # .venv/bin/activate on macOS/Linux
pip install -r requirements.txt scikit-image CoolProp
python -m app.main             # binds 0.0.0.0:8000 by default — see app/main.py
```

`python -m app.main` is the recommended way to just run it: it binds every
network interface (not just loopback) by default, which the mobile
remote-control feature (routers/remote.py) needs to let a phone on the LAN
reach this process — bare `uvicorn app.main:app` (or `--reload` for active
development) defaults to `127.0.0.1` instead, which no other device can ever
reach regardless of what IP the pairing QR code shows:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # for active development
```

`GET /health` reports which optional pieces are wired up:

```json
{"ok": true, "scikitImage": true, "coolProp": true, "openFoam": true}
```

## What's actually real

| Endpoint | Status |
| --- | --- |
| `POST /geometry/lattice` | **Real** — faithful port of `lib/tpms.ts` (same gyroid/Schwarz-P/Diamond/IWP fields, same iso-offset math) + `skimage.measure.marching_cubes` for extraction. Returns `501` until `pip install scikit-image`. |
| `POST /validate` | **Real** — open-edge / non-manifold-edge / shell-count / signed-volume check run directly on the triangle mesh (no mesh library dependency). |
| `GET /properties` | **Real equation of state** via CoolProp's `PropsSI` when `pip install CoolProp` is present (water/air/hydrogen); otherwise the same hand-fit correlations as `lib/fluidProperties.ts`. Response always says which (`source: "coolprop" | "correlation"`). |
| `POST /cases/{id}` + `GET /results/{id}` | **Real math, analytical model** — exact port of `lib/physics.ts`'s ε-NTU calculation. Not a solved field; `source: "analytical"` says so. |
| `POST /mesh` | **Real** when OpenFOAM is available and the request carries a full case spec (surface, cell geometry, tagged faces, hot/cold/solid materials — see `MeshRequest` in `schemas.py`): generates the case via `services/foam_case.py`, runs `blockMesh` → `snappyHexMesh` → `checkMesh` → `splitMeshRegions`, and returns real cell counts + mesh-quality metrics parsed from `checkMesh`'s own output. `source: "openfoam"`. Falls back to the synthetic cell-count estimate (`source: "synthetic"`) if OpenFOAM is unavailable or the request omits the case spec. |
| `POST /sweep` | **Synthetic placeholder** — the periodicity/block-independence check described in the README would need a real multi-cell solve to be honest; not implemented yet. `source: "synthetic"`. |
| `WS /solve` | **Real** once `POST /mesh` has generated a case (see `services/job_state.py` for the one-case-at-a-time handoff between the two routers): launches `chtMultiRegionSimpleFoam` as a subprocess and streams real per-iteration residuals parsed from its stdout, `source: "openfoam"`. Falls back to the synthetic exponential-decay stand-in (`source: "synthetic"`) if no case has been meshed yet or OpenFOAM is unavailable — same fallback behaviour the front end already had. |
| `POST /solve/field` | **Real** once a solve has completed: reads OpenFOAM's actual solved T/U/p output (`services/foam_field.py`) and nearest-cell-centre-samples it onto the caller's own surface points. `source: "openfoam"`. Only T is real for the solid region (no momentum equation there, and its `p` field never leaves its uniform initial value — checked empirically). 409/422 (never a synthetic body) if nothing's solved yet or the region/field combination has no real data; the front end falls back to the analytical contour model in `lib/contours.ts` on either. |
| `WS /mesh-independence` | **Real** — reruns the full mesh+solve pipeline once per requested background-cell resolution and reports how pressure drop/effectiveness move between them (real grid-convergence study, distinct from the still-synthetic `/sweep`). |
| `WS /uncertainty` | **Real** — reruns the full mesh+solve pipeline at nominal wall thickness and at thickness ± a manufacturing tolerance, reporting a genuine performance band instead of one deterministic number. |
| `WS /design-explorer` | **Real** — sweeps wall thickness and unit-cell scale, screens a candidate pool with `services/surrogate.py` (when enough history exists) or samples evenly otherwise, then actually meshes and solves the selected candidates and reports which are on a real Pareto front. |
| `POST /estimate` | **Real, but not a simulation** — instant performance estimate as a distance-weighted nearest-neighbour regression over every real case this server has solved (`services/design_history.py` + `services/surrogate.py`). 409 with an honest "not enough history yet" until at least 3 real solves exist for that surface type. |
| `GET /design-history/stats` | **Real** — how many real solved cases currently back the estimate, by surface type. |
| `POST /report` | **Real** — multi-page PDF (geometry views, mesh stats, analytical + solved performance, residual chart, mesh-independence table) rendered server-side; explicitly states when a section has nothing real to show rather than fabricating one. |
| `WS /remote` (+ `GET /remote/discover`) | **Real** — LAN pairing + a dumb WebSocket relay for the mobile phone-as-trackpad/3D-nav-controller feature; no server-side gesture interpretation. |

`services/foam.py` has `openfoam_available()` (checks `chtMultiRegionSimpleFoam`
and `snappyHexMesh` on `PATH`) plus a commented sketch of the case-generation
subprocess calls still needed. CoolProp, OpenFOAM, Gmsh, CGAL and OpenCASCADE
are native/Python-only libraries with no browser build, which is exactly why
this split exists.

### Design intelligence — history, estimates, tolerance bands, Pareto exploration

`services/design_history.py` is an append-only log (`app/data/design_history.jsonl`)
of every real solved case this server has produced: geometry + both streams'
fluid state + the solid, paired with `foam_metrics.solved_performance`'s real
output. Every one of `WS /solve`, `WS /mesh-independence`, `WS /uncertainty`
and `WS /design-explorer` appends to it on a converged run — there is no
separate "training mode", the log simply grows as the app gets used.

`services/surrogate.py` turns that log into an instant estimate: a
distance-weighted k-nearest-neighbour regression in normalized parameter
space, restricted to cases of the same TPMS surface type, with an honest
confidence score built from neighbour distance and sample count. It is
deliberately not a pretrained model shipped with the app and not backed by a
machine-learning library — every point behind an estimate is a real
OpenFOAM result from this deployment's own history, and the whole mechanism
is "average your nearest real neighbours," transparent enough to disclose in
the UI. `POST /estimate` exposes it directly; `WS /design-explorer` uses it
internally to decide which sweep candidates are worth spending real solve
time on, but always reports its final Pareto front from candidates that were
actually meshed and solved, never from the pre-screening prediction.

## Wiring the front end to this

Done — `src/lib/api.ts` is the client, `src/hooks/useBackendHealth.ts` pings
`/health` on startup (and keeps retrying while offline), and every one of the
5 integration points falls back to its original in-browser stand-in when the
backend is unreachable:

1. `src/hooks/useTasks.ts` → `runFill` calls `POST /validate`, `runMesh` calls `POST /mesh`, `runBlockCheck` calls `POST /sweep`
2. `src/hooks/useSolver.ts` → real `WebSocket /solve` when the backend's up, the original `setInterval` decay otherwise
3. `src/hooks/useBackendResultsSync.ts` (mounted once in `App.tsx`, not inside `usePhysics.ts` — that hook is called from ~8 components, so a side effect there fired duplicated) → `POST /cases/:id` then `GET /results/:id`, written to `store.backendPerformance` and shown as a cross-check in `ResultsPanel.tsx`
4. `src/store/useAppStore.ts`'s `setStreamTemperature`/`applyFluidPreset` → debounced `GET /properties`, upgrading the instant correlation estimate to a real CoolProp value once it resolves
5. `lib/tpms.ts` (geometry) is **not** wired to the live 3D viewport — the backend uses marching cubes, the browser uses a different real algorithm (surface nets), and swapping mid-session would visibly re-triangulate the mesh under the user. `fetchLatticeGeometry` exists in `api.ts` and is verified working; it's just not plugged into the render path.

Verified end-to-end with Playwright against real running containers, not just
typechecked — see [[wiring-lessons]] in project memory for two real bugs that
only surfaced that way (CORS port hardcoding, duplicate-effect network spam).

## Layout

```
app/
├── main.py                    FastAPI app, CORS, router wiring, /health, /queue-status
├── schemas.py                  pydantic mirrors of src/lib/types.ts
├── routers/
│   ├── geometry.py             POST /geometry/lattice
│   ├── mesh.py                  POST /mesh, /validate, /sweep, WS /mesh
│   ├── mesh_independence.py     WS /mesh-independence — real grid-convergence study
│   ├── uncertainty.py           WS /uncertainty — manufacturing-tolerance performance band
│   ├── explorer.py              WS /design-explorer — surrogate-screened Pareto sweep
│   ├── estimate.py              POST /estimate, GET /design-history/stats
│   ├── solve.py                  WS /solve, POST /solve/field
│   ├── results.py               POST /cases/{id}, GET /results/{id} — analytical ε-NTU
│   ├── report.py                POST /report — multi-page PDF
│   ├── remote.py                WS /remote, GET /remote/discover — mobile control relay
│   └── properties.py            GET /properties, GET /fluids
└── services/
    ├── tpms.py                  gyroid/Schwarz-P/Diamond/IWP fields + marching cubes
    ├── watertight.py            edge-manifoldness + signed-volume check
    ├── physics.py               ε-NTU performance port (analytical)
    ├── foam_case.py              real OpenFOAM case generation (blockMesh/snappyHexMesh/etc config)
    ├── foam_solve.py             shared real chtMultiRegionSimpleFoam subprocess/parse loop
    ├── foam_field.py             solved-field reading + nearest-cell sampling
    ├── foam_metrics.py           solved-field-derived performance (Δp, Q, effectiveness)
    ├── design_history.py         append-only log of every real solved case
    ├── surrogate.py              k-NN estimate over design_history.py
    ├── job_state.py              per-session case-directory registry
    ├── queue.py                  shared bounded-concurrency job queue
    ├── fluid_properties.py       CoolProp + correlation fallback
    ├── solid_properties.py       piecewise-linear k(T)/cp(T) for the built-in alloys
    ├── report_render.py          matplotlib geometry/contour/residual rendering for the PDF
    ├── report_pdf.py             Jinja2 + WeasyPrint HTML→PDF assembly
    ├── remote_hub.py             LAN discovery + WS relay for mobile control
    └── foam.py                   OpenFOAM detection + integration seam
```
