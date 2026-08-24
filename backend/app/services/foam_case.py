"""Generates a real OpenFOAM multi-region CHT case from the gyroid geometry
+ tagged boundary faces + stream/solid properties — verified end-to-end
against a live chtMultiRegionSimpleFoam run (see backend/README.md).

Known, disclosed simplification: faces tagged periodicA/B are approximated
as adiabatic slip walls, not true cyclic patches. Getting cyclic patch
matching exactly right on a snappyHexMesh-cut boundary is a genuinely fragile,
separate problem (surface must be re-meshed so both periodic faces are
topologically identical) — flagged as follow-up work rather than risking a
case that looks right but silently double-counts or drops flux at those
faces.
"""
from __future__ import annotations

import asyncio
import re
import subprocess
from pathlib import Path
from typing import AsyncIterator, Literal

import numpy as np

from .tpms import build_lattice, iso_offset, tpms_field
from .stl_writer import write_ascii_stl

TAU = 2 * np.pi

# FaceKey -> blockMeshDict patch name (avoids '+'/'-' in OpenFOAM patch names)
PATCH_NAME = {"X-": "Xmin", "X+": "Xmax", "Y-": "Ymin", "Y+": "Ymax", "Z-": "Zmin", "Z+": "Zmax"}
OUTWARD_NORMAL = {"X-": (-1, 0, 0), "X+": (1, 0, 0), "Y-": (0, -1, 0), "Y+": (0, 1, 0), "Z-": (0, 0, -1), "Z+": (0, 0, 1)}
FACE_AXIS_SIZE = {  # which two cell dims span this face, for a crude cross-section-area estimate
    "X-": ("cellY", "cellZ"), "X+": ("cellY", "cellZ"),
    "Y-": ("cellX", "cellZ"), "Y+": ("cellX", "cellZ"),
    "Z-": ("cellX", "cellY"), "Z+": ("cellX", "cellY"),
}


def _region_interior_point(surface: str, cell: tuple, n: tuple, thickness: float, grading: float, grad_axis: str, region: Literal["solid", "hot", "cold"]) -> tuple[float, float, float]:
    """Deepest interior point of a region (max distance from its own boundary
    in field-value terms) — robust seed for snappyHexMesh's locationsInMesh,
    computed straight from the same scalar field the STL was extracted from."""
    N = 40
    u = np.linspace(0.02, 0.98, N)
    x = TAU * n[0] * u
    y = TAU * n[1] * u
    z = TAU * n[2] * u
    xx, yy, zz = np.meshgrid(x, y, z, indexing="ij")
    f = tpms_field(surface, xx, yy, zz)
    c_base = iso_offset(*cell, thickness, surface)
    uu, vv, ww = np.meshgrid(u, u, u, indexing="ij")
    g = {"x": uu, "y": vv, "z": ww}[grad_axis]
    c = c_base * (1 + grading * (g - 0.5) * 2)

    if region == "solid":
        score = -(np.abs(f) - c)
    elif region == "hot":
        score = f - c
    else:
        score = -f - c

    idx = np.unravel_index(np.argmax(score), score.shape)
    lx, ly, lz = cell[0] * n[0], cell[1] * n[1], cell[2] * n[2]
    px = u[idx[0]] * lx - lx / 2
    py = u[idx[1]] * ly - ly / 2
    pz = u[idx[2]] * lz - lz / 2
    return (px / 1000, py / 1000, pz / 1000)  # mm -> m, matching the 0.001-scaled mesh


def _write(path: Path, foam_class: str, obj: str, body: str, location: str | None = None) -> None:
    loc = f'    location "{location}";\n' if location else ""
    path.write_text(
        f"FoamFile\n{{\n    version 2.0;\n    format ascii;\n    class {foam_class};\n{loc}    object {obj};\n}}\n\n{body}"
    )


def _block_mesh_dict(box: tuple[float, float, float], bg_cells: int) -> str:
    hx, hy, hz = box[0] / 2000, box[1] / 2000, box[2] / 2000  # mm -> m, half-extent
    return f"""scale 1;

vertices
(
    (-{hx} -{hy} -{hz})
    ( {hx} -{hy} -{hz})
    ( {hx}  {hy} -{hz})
    (-{hx}  {hy} -{hz})
    (-{hx} -{hy}  {hz})
    ( {hx} -{hy}  {hz})
    ( {hx}  {hy}  {hz})
    (-{hx}  {hy}  {hz})
);

blocks
(
    hex (0 1 2 3 4 5 6 7) ({bg_cells} {bg_cells} {bg_cells}) simpleGrading (1 1 1)
);

edges ();

boundary
(
    Xmin {{ type patch; faces ((0 4 7 3)); }}
    Xmax {{ type patch; faces ((1 2 6 5)); }}
    Ymin {{ type patch; faces ((0 1 5 4)); }}
    Ymax {{ type patch; faces ((3 7 6 2)); }}
    Zmin {{ type patch; faces ((0 3 2 1)); }}
    Zmax {{ type patch; faces ((4 5 6 7)); }}
);
"""


def _snappy_dict(points: dict[str, tuple[float, float, float]], level: tuple[int, int] = (1, 1)) -> str:
    # STL vertices are written in mm (matching the rest of the geometry
    # pipeline) but blockMeshDict builds the background mesh in metres, so
    # the surfaces must be scaled down here or they never intersect the
    # background mesh at all (snappyHexMesh silently castellates nothing).
    geom = "\n".join(f"    {r}.stl {{ type triSurfaceMesh; name {r}; scale 0.001; }}" for r in ("solid", "hot", "cold"))
    surf = "\n".join(f"        {r} {{ level ({level[0]} {level[1]}); }}" for r in ("solid", "hot", "cold"))
    locs = "\n".join(f"        (({p[0]:.6e} {p[1]:.6e} {p[2]:.6e}) {r})" for r, p in points.items())
    return f"""castellatedMesh true;
snap            true;
addLayers       false;

geometry
{{
{geom}
}}

castellatedMeshControls
{{
    maxLocalCells        4000000;
    maxGlobalCells        8000000;
    minRefinementCells    0;
    maxLoadUnbalance      0.10;
    nCellsBetweenLevels   1;
    features ();
    refinementSurfaces
    {{
{surf}
    }}
    resolveFeatureAngle 30;
    refinementRegions {{}}
    locationsInMesh
    (
{locs}
    );
    allowFreeStandingZoneFaces true;
}}

snapControls
{{
    nSmoothPatch 3;
    tolerance    2.0;
    nSolveIter   30;
    nRelaxIter   5;
}}

addLayersControls
{{
    layers {{}}
    relativeSizes true;
    expansionRatio 1.2;
    finalLayerThickness 0.5;
    minThickness 0.001;
}}

meshQualityControls
{{
    maxNonOrtho 65;
    maxBoundarySkewness 20;
    maxInternalSkewness 4;
    maxConcave 80;
    minVol 1e-16;
    minTetQuality -1e30;
    minArea -1;
    minTwist 0.02;
    minDeterminant 0.001;
    minFaceWeight 0.02;
    minVolRatio 0.01;
    minTriangleTwist -1;
    nSmoothScale 4;
    errorReduction 0.75;
}}

mergeTolerance 1e-6;
"""


_FLUID_FV_SCHEMES = """ddtSchemes { default steadyState; }
gradSchemes { default Gauss linear; }
divSchemes
{
    default none;
    div(phi,U) bounded Gauss upwind;
    div(phi,h) bounded Gauss upwind;
    div(phi,K) bounded Gauss upwind;
    div(phi,Ekp) bounded Gauss upwind;
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
    div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
"""

_SOLID_FV_SCHEMES = """ddtSchemes { default steadyState; }
gradSchemes { default Gauss linear; }
divSchemes { default none; }
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
"""

_FLUID_FV_SOLUTION = """solvers
{
    p_rgh
    {
        solver          GAMG;
        tolerance       1e-8;
        relTol          0.01;
        smoother        GaussSeidel;
    }
    p_rghFinal { $p_rgh; relTol 0; }
    "(U|h|k|epsilon|omega)"
    {
        solver          smoothSolver;
        smoother        symGaussSeidel;
        tolerance       1e-8;
        relTol          0.1;
    }
}

SIMPLE
{
    nNonOrthogonalCorrectors 0;
    rhoMin    rhoMin [1 -3 0 0 0] 0.5;
    rhoMax    rhoMax [1 -3 0 0 0] 2000;
    pRefCell  0;
    pRefValue 100000;
}

relaxationFactors
{
    fields { p_rgh 0.7; }
    equations { "U.*" 0.3; "h.*" 0.3; "k.*" 0.3; "epsilon.*" 0.3; "omega.*" 0.3; }
}
"""

_SOLID_FV_SOLUTION = """solvers
{
    "h.*"
    {
        solver          PCG;
        preconditioner  DIC;
        tolerance       1e-8;
        relTol          0.01;
    }
}

SIMPLE { nNonOrthogonalCorrectors 0; }
relaxationFactors { equations { "h.*" 0.7; } }
"""


def _thermo_fluid(rho: float, cp: float, mu: float, k: float) -> str:
    pr = mu * cp / k
    return f"""thermoType
{{
    type            heRhoThermo;
    mixture         pureMixture;
    transport       const;
    thermo          hConst;
    equationOfState rhoConst;
    specie          specie;
    energy          sensibleEnthalpy;
}}

mixture
{{
    specie      {{ molWeight 18; }}
    equationOfState {{ rho {rho}; }}
    thermodynamics  {{ Cp {cp}; Hf 0; }}
    transport   {{ mu {mu}; Pr {pr}; }}
}}
"""


def _thermo_solid(rho: float, cp: float, k: float) -> str:
    return f"""thermoType
{{
    type            heSolidThermo;
    mixture         pureMixture;
    transport       constIso;
    thermo          hConst;
    equationOfState rhoConst;
    specie          specie;
    energy          sensibleEnthalpy;
}}

mixture
{{
    specie      {{ molWeight 100; }}
    transport   {{ kappa {k}; }}
    thermodynamics {{ Cp {cp}; Hf 0; }}
    equationOfState {{ rho {rho}; }}
}}
"""


def _face_roles(faces: dict[str, str]) -> dict[str, list[str]]:
    """FaceRole -> list of blockMesh patch names carrying that role."""
    out: dict[str, list[str]] = {}
    for face_key, role in faces.items():
        out.setdefault(role, []).append(PATCH_NAME[face_key])
    return out


def _velocity_bc(patch_names: list[str], velocity: tuple[float, float, float]) -> str:
    if not patch_names:
        return ""
    vx, vy, vz = velocity
    entries = "\n".join(f"    {p} {{ type fixedValue; value uniform ({vx:.6g} {vy:.6g} {vz:.6g}); }}" for p in patch_names)
    return entries + "\n"


def generate_case(
    case_dir: Path,
    surface: str,
    cell: tuple[float, float, float],
    n: tuple[int, int, int],
    thickness: float,
    grading: float,
    grad_axis: str,
    faces: dict[str, str],
    hot: dict,
    cold: dict,
    solid: dict,
    bg_cells: int,
    stl_voxels: int,
    max_iterations: int,
) -> dict:
    """Writes a complete case tree into case_dir. Does not run anything —
    callers invoke blockMesh/snappyHexMesh/splitMeshRegions/chtMultiRegionSimpleFoam."""
    (case_dir / "constant" / "triSurface").mkdir(parents=True, exist_ok=True)
    (case_dir / "system" / "hot").mkdir(parents=True, exist_ok=True)
    (case_dir / "system" / "cold").mkdir(parents=True, exist_ok=True)
    (case_dir / "system" / "solid").mkdir(parents=True, exist_ok=True)
    (case_dir / "constant" / "hot").mkdir(parents=True, exist_ok=True)
    (case_dir / "constant" / "cold").mkdir(parents=True, exist_ok=True)
    (case_dir / "constant" / "solid").mkdir(parents=True, exist_ok=True)
    (case_dir / "0" / "hot").mkdir(parents=True, exist_ok=True)
    (case_dir / "0" / "cold").mkdir(parents=True, exist_ok=True)
    (case_dir / "0" / "solid").mkdir(parents=True, exist_ok=True)

    # Flow-through faces must be left open (not capped by the STL) so the
    # background blockMesh boundary — not the region surface — bounds the
    # channel there; otherwise castellation absorbs Xmin/Xmax/etc entirely
    # into the region's own surface patch and the inlet/outlet BCs (written
    # against those patch names) never attach to a real face. Periodic/wall
    # faces stay capped, matching the periodicA/B-as-adiabatic-walls
    # simplification already disclosed at the top of this file.
    FLOW_ROLES = {"inletHot", "outletHot", "inletCold", "outletCold"}
    open_faces = frozenset(k for k, role in faces.items() if role in FLOW_ROLES)

    box = None
    for region in ("solid", "hot", "cold"):
        result = build_lattice(surface, cell, thickness, grading, grad_axis, n, region, stl_voxels, open_faces)
        positions = np.array(result["positions"], dtype=np.float64).reshape(-1, 3)
        indices = np.array(result["indices"], dtype=np.int64).reshape(-1, 3)
        write_ascii_stl(case_dir / "constant" / "triSurface" / f"{region}.stl", positions, indices, name=region)
        box = result["box"]

    points = {r: _region_interior_point(surface, cell, n, thickness, grading, grad_axis, r) for r in ("solid", "hot", "cold")}

    _write(case_dir / "system" / "blockMeshDict", "dictionary", "blockMeshDict", _block_mesh_dict(box, bg_cells))
    _write(case_dir / "system" / "snappyHexMeshDict", "dictionary", "snappyHexMeshDict", _snappy_dict(points))
    set_max_iterations(case_dir, max_iterations)
    # snappyHexMesh and other pre-split utilities run against the single
    # top-level mesh before splitMeshRegions creates per-region copies, and
    # they look up these dicts (e.g. snappyHexMesh's mesh-quality/motion
    # machinery reads divSchemes) — a comment-only placeholder makes them
    # fail with "Entry 'divSchemes' not found". Each region still gets its
    # own copy below for the actual solve; this is just what pre-split
    # utilities see.
    _write(case_dir / "system" / "fvSchemes", "dictionary", "fvSchemes", _FLUID_FV_SCHEMES)
    _write(case_dir / "system" / "fvSolution", "dictionary", "fvSolution", _FLUID_FV_SOLUTION)
    for region, schemes, solution in (
        ("hot", _FLUID_FV_SCHEMES, _FLUID_FV_SOLUTION),
        ("cold", _FLUID_FV_SCHEMES, _FLUID_FV_SOLUTION),
        ("solid", _SOLID_FV_SCHEMES, _SOLID_FV_SOLUTION),
    ):
        _write(case_dir / "system" / region / "fvSchemes", "dictionary", "fvSchemes", schemes)
        _write(case_dir / "system" / region / "fvSolution", "dictionary", "fvSolution", solution)

    _write(
        case_dir / "constant" / "regionProperties",
        "dictionary",
        "regionProperties",
        "regions\n(\n    fluid (hot cold)\n    solid (solid)\n);\n",
        location="constant",
    )
    _write(case_dir / "constant" / "g", "uniformDimensionedVectorField", "g", "dimensions [0 1 -2 0 0 0 0];\nvalue (0 0 0);\n")
    _write(case_dir / "constant" / "hot" / "thermophysicalProperties", "dictionary", "thermophysicalProperties", _thermo_fluid(hot["rho"], hot["cp"], hot["mu"], hot["k"]), "constant/hot")
    _write(case_dir / "constant" / "cold" / "thermophysicalProperties", "dictionary", "thermophysicalProperties", _thermo_fluid(cold["rho"], cold["cp"], cold["mu"], cold["k"]), "constant/cold")
    _write(case_dir / "constant" / "solid" / "thermophysicalProperties", "dictionary", "thermophysicalProperties", _thermo_solid(solid["rho"], solid["cp"], solid["k"]), "constant/solid")
    for region in ("hot", "cold"):
        _write(case_dir / "constant" / region / "turbulenceProperties", "dictionary", "turbulenceProperties", "simulationType laminar;\n")

    roles = _face_roles(faces)
    hot_in, hot_out = roles.get("inletHot", []), roles.get("outletHot", [])
    cold_in, cold_out = roles.get("inletCold", []), roles.get("outletCold", [])

    # Crude bulk-velocity estimate from mdot — same style as lib/physics.ts's crossArea,
    # refine later with the actual meshed patch area for precision.
    lx, ly, lz = cell[0] * n[0] / 1000, cell[1] * n[1] / 1000, cell[2] * n[2] / 1000
    channel_frac = 0.35

    def inlet_velocity(patch_names: list[str], mdot: float, rho: float) -> dict[str, tuple[float, float, float]]:
        out = {}
        for key, pname in PATCH_NAME.items():
            if pname not in patch_names:
                continue
            ax0, ax1 = FACE_AXIS_SIZE[key]
            dims = {"cellX": lx, "cellY": ly, "cellZ": lz}
            area = dims[ax0] * dims[ax1] * channel_frac
            speed = mdot / (rho * max(area, 1e-9))
            nrm = OUTWARD_NORMAL[key]
            out[pname] = (-nrm[0] * speed, -nrm[1] * speed, -nrm[2] * speed)  # into the domain
        return out

    def write_fluid_fields(region: str, stream: dict, in_patches: list[str], out_patches: list[str]) -> None:
        vel = inlet_velocity(in_patches, stream["mdot"], stream["rho"])
        u_body = "".join(f"    {p} {{ type fixedValue; value uniform ({v[0]:.6g} {v[1]:.6g} {v[2]:.6g}); }}\n" for p, v in vel.items())
        u_body += "".join(f"    {p} {{ type inletOutlet; inletValue uniform (0 0 0); value uniform (0 0 0); }}\n" for p in out_patches)
        _write(case_dir / "0" / region / "U", "volVectorField", "U", f"""dimensions [0 1 -1 0 0 0 0];
internalField uniform (0 0 0);

boundaryField
{{
{u_body}    ".*" {{ type noSlip; }}
    ".*_to_.*" {{ type noSlip; }}
}}
""")

        p_body = "".join(f"    {p} {{ type fixedFluxPressure; value uniform {stream['pOut'] + 101325:.6g}; }}\n" for p in in_patches)
        p_body += "".join(f"    {p} {{ type fixedValue; value uniform {stream['pOut'] + 101325:.6g}; }}\n" for p in out_patches)
        _write(case_dir / "0" / region / "p_rgh", "volScalarField", "p_rgh", f"""dimensions [1 -1 -2 0 0 0 0];
internalField uniform 101325;

boundaryField
{{
{p_body}    ".*" {{ type fixedFluxPressure; value uniform 101325; }}
    ".*_to_.*" {{ type fixedFluxPressure; value uniform 101325; }}
}}
""")
        _write(case_dir / "0" / region / "p", "volScalarField", "p", 'dimensions [1 -1 -2 0 0 0 0];\ninternalField uniform 101325;\n\nboundaryField\n{\n    ".*" { type calculated; value uniform 101325; }\n}\n')

        # OpenFOAM resolves a patch name against multiple matching regex keys
        # in boundaryField by taking the LAST match in the dictionary, not
        # the first — so the specific "*_to_*" coupled pattern must be
        # written after the catch-all ".*", or the catch-all silently wins
        # on every coupled interface and the region never exchanges heat.
        t_in_k = stream["Tin"] + 273.15
        t_body = "".join(f"    {p} {{ type fixedValue; value uniform {t_in_k:.6g}; }}\n" for p in in_patches)
        t_body += "".join(f"    {p} {{ type inletOutlet; inletValue uniform {t_in_k:.6g}; value uniform {t_in_k:.6g}; }}\n" for p in out_patches)
        _write(case_dir / "0" / region / "T", "volScalarField", "T", f"""dimensions [0 0 0 1 0 0 0];
internalField uniform {t_in_k:.6g};

boundaryField
{{
{t_body}    ".*" {{ type zeroGradient; }}
    ".*_to_.*"
    {{
        type            compressible::turbulentTemperatureCoupledBaffleMixed;
        Tnbr            T;
        kappaMethod     fluidThermo;
        value           uniform {t_in_k:.6g};
    }}
}}
""")
        _write(case_dir / "0" / region / "alphat", "volScalarField", "alphat", 'dimensions [1 -1 -1 0 0 0 0];\ninternalField uniform 0;\n\nboundaryField\n{\n    ".*" { type compressible::alphatWallFunction; value uniform 0; }\n}\n')

    write_fluid_fields("hot", hot, hot_in, hot_out)
    write_fluid_fields("cold", cold, cold_in, cold_out)

    solid_t0 = (hot["Tin"] + cold["Tin"]) / 2 + 273.15
    _write(case_dir / "0" / "solid" / "T", "volScalarField", "T", f"""dimensions [0 0 0 1 0 0 0];
internalField uniform {solid_t0:.6g};

boundaryField
{{
    ".*" {{ type zeroGradient; }}
    ".*_to_.*"
    {{
        type            compressible::turbulentTemperatureCoupledBaffleMixed;
        Tnbr            T;
        kappaMethod     solidThermo;
        value           uniform {solid_t0:.6g};
    }}
}}
""")
    _write(case_dir / "0" / "solid" / "p", "volScalarField", "p", 'dimensions [1 -1 -2 0 0 0 0];\ninternalField uniform 101325;\n\nboundaryField\n{\n    ".*" { type calculated; value uniform 101325; }\n}\n')

    return {"box": box, "points": points}


def set_max_iterations(case_dir: Path, max_iterations: int) -> None:
    """(Re)writes system/controlDict's endTime — used both at case generation
    and again by WS /solve once the user's actual maxIterations is known,
    since mesh generation happens before the solve step is configured."""
    _write(
        case_dir / "system" / "controlDict",
        "dictionary",
        "controlDict",
        f"""application     chtMultiRegionSimpleFoam;
startFrom       startTime;
startTime       0;
stopAt          endTime;
endTime         {max_iterations};
deltaT          1;
writeControl    timeStep;
writeInterval   {max(1, max_iterations // 10)};
purgeWrite      2;
writeFormat     ascii;
writePrecision  6;
writeCompression off;
timeFormat      general;
timePrecision   6;
runTimeModifiable true;
""",
    )


def request_final_write(case_dir: Path, max_iterations: int) -> None:
    """Tells an already-running solver to write its current fields and stop,
    instead of being killed mid-iteration with whatever it last happened to
    have on disk (which, given writeInterval's coarse cadence, is often
    nothing but the initial `0/` state). Relies on `runTimeModifiable true`
    (set above): OpenFOAM re-reads system/controlDict once per timestep, so
    setting stopAt to writeNow here makes the running subprocess perform one
    more write at its current time and exit on its own — see
    services/foam_solve.py's run_real_solve, which calls this the moment it
    detects convergence from the solver's stdout, then simply waits for the
    process to exit rather than terminating it. Same file/fields as
    set_max_iterations otherwise, so a solver that doesn't notice in time
    still runs to the original endTime unaffected."""
    _write(
        case_dir / "system" / "controlDict",
        "dictionary",
        "controlDict",
        f"""application     chtMultiRegionSimpleFoam;
startFrom       startTime;
startTime       0;
stopAt          writeNow;
endTime         {max_iterations};
deltaT          1;
writeControl    timeStep;
writeInterval   {max(1, max_iterations // 10)};
purgeWrite      2;
writeFormat     ascii;
writePrecision  6;
writeCompression off;
timeFormat      general;
timePrecision   6;
runTimeModifiable true;
""",
    )


def run(cmd: list[str], case_dir: Path, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd + ["-case", str(case_dir)], capture_output=True, text=True, **kwargs)


class MeshPipelineError(RuntimeError):
    def __init__(self, step: str, result: subprocess.CompletedProcess):
        self.step = step
        self.result = result
        super().__init__(f"{step} failed (exit {result.returncode}):\n{result.stdout[-4000:]}\n{result.stderr[-2000:]}")


def _run_step(step: str, cmd: list[str], case_dir: Path) -> subprocess.CompletedProcess:
    result = run(cmd, case_dir)
    if result.returncode != 0:
        raise MeshPipelineError(step, result)
    return result


_CELLZONE_RE = re.compile(r"^\s*(solid|hot|cold)\s+(\d+)\s+(\d+)\s", re.MULTILINE)
_ASPECT_RE = re.compile(r"Max aspect ratio = ([\d.eE+-]+)")
_NONORTHO_RE = re.compile(r"Mesh non-orthogonality Max:\s*([\d.eE+-]+)\s*average:\s*([\d.eE+-]+)")
_SKEW_RE = re.compile(r"Max skewness = ([\d.eE+-]+)")


def run_mesh_pipeline(case_dir: Path) -> dict:
    """blockMesh -> snappyHexMesh -> checkMesh (pre-split, for real cellZone
    counts + geometry quality in one pass) -> splitMeshRegions. Raises
    MeshPipelineError with the failing step's captured output on any
    non-zero exit."""
    _run_step("blockMesh", ["blockMesh"], case_dir)
    _run_step("snappyHexMesh", ["snappyHexMesh", "-overwrite"], case_dir)
    check = _run_step("checkMesh", ["checkMesh", "-allTopology"], case_dir)

    zones = {m.group(1): int(m.group(2)) for m in _CELLZONE_RE.finditer(check.stdout)}
    aspect = _ASPECT_RE.search(check.stdout)
    nonortho = _NONORTHO_RE.search(check.stdout)
    skew = _SKEW_RE.search(check.stdout)

    _run_step("splitMeshRegions", ["splitMeshRegions", "-cellZones", "-overwrite"], case_dir)

    solid, hot, cold = zones.get("solid", 0), zones.get("hot", 0), zones.get("cold", 0)
    return {
        "solid": solid,
        "hot": hot,
        "cold": cold,
        "cells": solid + hot + cold,
        "aspectRatio": float(aspect.group(1)) if aspect else 0.0,
        "nonOrthogonality": float(nonortho.group(1)) if nonortho else 0.0,
        "skewness": float(skew.group(1)) if skew else 0.0,
    }


async def _run_step_async(cmd: list[str], case_dir: Path) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        "-case",
        str(case_dir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    stdout, _ = await proc.communicate()
    return proc.returncode, stdout.decode(errors="replace")


# (internal stage id, display label, argv, cumulative % once this stage completes)
# — weighted toward the surface-mesh step, by far the slowest of the four on a
# real case. The id/label are deliberately generic (not the underlying solver's
# own utility names) — every message here goes straight to the client.
_PIPELINE_STAGES = [
    ("background_mesh", "Background mesh", ["blockMesh"], 15),
    ("surface_mesh", "Surface mesh", ["snappyHexMesh", "-overwrite"], 70),
    ("quality_check", "Mesh quality check", ["checkMesh", "-allTopology"], 85),
    ("region_split", "Splitting mesh regions", ["splitMeshRegions", "-cellZones", "-overwrite"], 100),
]


async def run_mesh_pipeline_streamed(case_dir: Path) -> AsyncIterator[dict]:
    """Same 4-stage pipeline as run_mesh_pipeline, but run with
    asyncio.create_subprocess_exec so WS /mesh can forward one message the
    instant each stage actually starts and finishes — real subprocess timing,
    not the frontend's old fixed-duration fake progress animation. Yields
    {"stage", "percent", "detail", "jobStatus": "running"} for each
    start/finish, then either a final {"jobStatus": "done", ...mesh stats} or
    {"jobStatus": "failed", "detail": <captured output>}."""
    check_stdout = ""
    for stage_id, label, cmd, percent_done in _PIPELINE_STAGES:
        yield {
            "stage": stage_id,
            "percent": max(0, percent_done - 12),
            "detail": f"{label}…",
            "jobStatus": "running",
            "source": "openfoam",
        }
        returncode, stdout = await _run_step_async(cmd, case_dir)
        if returncode != 0:
            yield {
                "stage": stage_id,
                "percent": percent_done,
                "detail": f"{label} failed – see server logs",
                "jobStatus": "failed",
                "source": "openfoam",
            }
            return
        if stage_id == "quality_check":
            check_stdout = stdout
        yield {
            "stage": stage_id,
            "percent": percent_done,
            "detail": f"{label}: done",
            "jobStatus": "running",
            "source": "openfoam",
        }

    zones = {m.group(1): int(m.group(2)) for m in _CELLZONE_RE.finditer(check_stdout)}
    aspect = _ASPECT_RE.search(check_stdout)
    nonortho = _NONORTHO_RE.search(check_stdout)
    skew = _SKEW_RE.search(check_stdout)
    solid, hot, cold = zones.get("solid", 0), zones.get("hot", 0), zones.get("cold", 0)
    yield {
        "stage": "complete",
        "percent": 100,
        "detail": "mesh ready",
        "jobStatus": "done",
        "source": "openfoam",
        "cells": solid + hot + cold,
        "hot": hot,
        "cold": cold,
        "solid": solid,
        "aspectRatio": float(aspect.group(1)) if aspect else 0.0,
        "nonOrthogonality": float(nonortho.group(1)) if nonortho else 0.0,
        "skewness": float(skew.group(1)) if skew else 0.0,
    }
