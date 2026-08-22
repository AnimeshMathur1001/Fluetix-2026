# Fluetix

Desktop-style workspace for designing TPMS lattice walls, assembling them into two-fluid heat
exchanger geometries, and setting up / reviewing conjugate heat transfer CFD cases.

Two parts: this repo root is the React/Three.js **front end**; `backend/` is a FastAPI service
that does the geometry/mesh/property/CFD work no browser can do natively — see
[backend/README.md](backend/README.md) for exactly what's real there versus a labelled placeholder.

Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.
Licensed under the [Apache License, Version 2.0](LICENSE) — see also [NOTICE](NOTICE).

## Windows installer

For a normal user who just wants to run the app — no `git clone`, no manual dependency install —
see [installer/README.md](installer/README.md). It builds a single `Fluetix-2026-Setup.exe` that
auto-installs Python and the GTK3 runtime (via `winget`) if missing, sets up a private Python
environment for the app, and adds Start Menu / Desktop shortcuts. Everything it installs is free
and open source.

## Run the whole thing (recommended, for development)

```bash
docker compose up --build
```

Frontend at <http://localhost:5173>, backend at <http://localhost:8000>. This is the single
command that gets someone else's machine running the complete app, real OpenFOAM solver included —
`backend/Dockerfile` builds `FROM opencfd/openfoam-run`, so there's nothing to install by hand. No
Node, no Python, no WSL required on the host; only Docker.

## Run the front end alone (in-browser stand-ins, no backend)

```bash
npm install
npm run dev
```

Vite serves on <http://localhost:5173> and opens a browser tab. Every feature works this way —
geometry, watertightness, properties, and performance numbers all have honest in-browser
approximations that activate automatically whenever `backend: offline` shows in the footer.

```bash
npm run build      # type-check + production bundle into dist/
npm run preview    # serve the production bundle
npm run typecheck  # tsc --noEmit only
```

Requires Node 18 or newer.

## Stack

React 18 · TypeScript (strict) · Vite 5 · TailwindCSS 3 · Three.js · React Three Fiber · Drei ·
Zustand · Framer Motion · Lucide React.

## Layout

```
src/
├── components/
│   ├── Header.tsx              app title, case name, mode badge, execution status, About
│   ├── WorkflowStepper.tsx     Geometry → Regions → Case → Mesh & Solve → Results → Scale-up → Explore
│   ├── StatusBar.tsx           footer: task status, mode, geometry and mesh counters
│   ├── AboutDialog.tsx         about / stack / out-of-scope panel
│   ├── Toast.tsx               transient confirmations
│   ├── ui/                     SliderInput, NumericInput, SelectInput, SegmentedControl,
│   │                           MetricRow, SectionTitle, ActionButton, Toggle, CardButton
│   ├── viewport/               Canvas, CameraRig, LatticeMesh, toolbar, stats, legend,
│   │                           point-probe card, progress overlay
│   └── panels/                 one panel per workflow phase + SurfaceSelector, ResidualChart
├── hooks/
│   ├── useLatticeGeometry.ts   field → surface extraction → BufferGeometry (+ contours)
│   ├── usePhysics.ts           memoised unit-cell performance and scale-up
│   ├── useSolver.ts            residual stream, convergence / cancel handling
│   ├── useTasks.ts             staged progress for fill, mesh, sweeps, validation, import
│   └── useDebounced.ts
├── lib/
│   ├── tpms.ts                 gyroid / Schwarz-P / Diamond / IWP level sets, scalar field,
│   │                           adaptive voxel budget + triangle/memory estimate for Generate
│   ├── surfaceNets.ts          dual-contour surface extraction
│   ├── contours.ts             colour ramps and per-vertex field sampling
│   ├── physics.ts              Δp, h, UA, NTU, ε, Q + analytical scale-up
│   ├── fluidProperties.ts      temperature-dependent correlations (CoolProp stand-in, see below)
│   ├── flow.ts                 auto parallel/counter/cross detection from tagged inlet faces
│   ├── cameraSync.ts           shares camera orientation with the corner nav cube
│   ├── exporters.ts            binary STL, OBJ, STEP header, CSV flattener
│   ├── report.ts               exportable report assembly
│   ├── presets.ts              fluid / solid / surface / face-role libraries
│   └── types.ts
└── store/useAppStore.ts        single Zustand store for the whole workflow
```

## What the geometry does

`lib/tpms.ts` evaluates the implicit trigonometric level set for the selected surface over the block,
converts a physical wall thickness into an iso-offset (`|f| < c`), applies the thickness gradient, and
forces the domain border positive so the extracted shell is closed. `lib/surfaceNets.ts` extracts the
region boundary. The result feeds:

- the viewport mesh and its bounding box,
- solid fraction and specific surface area (measured from the triangulation, not assumed),
- hydraulic diameter and therefore every performance number,
- STL export.

Region selection switches which field is contoured: `|f| − c` for the solid wall, `c − f` for the hot
channel, `f + c` for the cold channel.

## Back-end integration

Done — see [backend/README.md § Wiring the front end to this](backend/README.md#wiring-the-front-end-to-this)
for exactly which hook calls which endpoint. Summary:

| Module | Wired to |
| --- | --- |
| `hooks/useTasks.ts` | `POST /mesh`, `POST /validate`, `POST /sweep` |
| `hooks/useSolver.ts` | `WS /solve` — real when the backend + OpenFOAM are up, in-browser decay stand-in otherwise |
| `hooks/useBackendResultsSync.ts` | `POST /cases/:id` + `GET /results/:id` — cross-checked against `lib/physics.ts`, shown in Results panel |
| `hooks/useLatticeGeometry.ts` | `POST /solve/field` — real OpenFOAM T/U/p sampled onto the rendered surface when a solve has completed and the Results panel's "Solved field (OpenFOAM)" toggle is selected; the analytical model in `lib/contours.ts` otherwise |
| `store/useAppStore.ts` | `GET /properties?fluid=&T=&P=` — debounced upgrade from correlation to real CoolProp |
| `lib/tpms.ts` | **Not wired to the live viewport** — see backend README for why (algorithm mismatch would visibly re-triangulate the mesh mid-session); `POST /geometry/lattice` exists and works, just isn't in the render path |
| `hooks/useUncertaintyBand.ts` | `WS /uncertainty` — real mesh+solve at wall thickness ± a manufacturing tolerance, reported as a performance band |
| `hooks/useDesignExplorer.ts` | `WS /design-explorer` — real multi-objective sweep (thickness × cell scale), surrogate-screened, real Pareto front |
| `components/ui/QuickEstimateCard.tsx` | `POST /estimate` — instant estimate from this server's own solve history |

Every wired call falls back to its original in-browser approximation when the backend is unreachable
(`backend: offline` in the footer) — `lib/fluidProperties.ts` (Vogel/Sutherland correlations) still
exists and still runs, it's just no longer the only option. CoolProp, OpenFOAM, Gmsh, CGAL and
OpenCASCADE are native/Python libraries with no browser build, which is why this split exists at all.
The mesh-independence / GCI study stays removed from the Results and Mesh panels — it would need a
real multi-resolution sweep, which isn't implemented (`POST /sweep` is still a synthetic placeholder).
`POST /mesh` and `WS /solve` are real — full blockMesh/snappyHexMesh/splitMeshRegions pipeline and a
real streamed `chtMultiRegionSimpleFoam` solve — when OpenFOAM is available (see backend README).

STEP export is a best-effort tessellated B-Rep (TPMS surfaces aren't NURBS-representable regardless of
back end). STL and OBJ stay the primary, universally-importable export formats.

## Design intelligence

Three features build on `backend/app/services/design_history.py`, an append-only log of every real
solved case (see backend README § Design intelligence for the mechanism):

- **Quick estimate** (`POST /estimate`) — instant performance estimate as a distance-weighted
  nearest-neighbour regression over previously solved cases of the same TPMS surface type. Not a
  simulation; shows an honest "not enough history yet" until at least 3 real solves exist.
- **Manufacturing-tolerance sensitivity** (`WS /uncertainty`) — reruns the real pipeline at nominal
  wall thickness and at thickness ± a tolerance, reporting a genuine performance band.
- **Design explorer** (`WS /design-explorer`, Explore step) — sweeps wall thickness and unit-cell
  scale, pre-screens candidates with the same estimate model when enough history exists, then
  actually meshes and solves the selected candidates and reports a real Pareto front across
  effectiveness, pressure drop, and solid fraction.

## Out of scope

No native SolidWorks export, no GPU-accelerated solve, steady-state only, single-phase only, no FEA.
The periodicity/block-independence check (`POST /sweep`) is still a synthetic placeholder — real
mesh-independence (`WS /mesh-independence`) is a separate, already-real check.
