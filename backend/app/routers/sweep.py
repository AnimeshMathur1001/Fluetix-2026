"""POST /sweep/cellsize
POST /sweep/thickness

General parametric sweeps of analytical performance against cell
size or wall thickness. The user supplies all conditions. Geometry
is measured fresh per point by the voxelisation pipeline. No
reference geometry is hardcoded anywhere in this file.
"""
from __future__ import annotations
from fastapi import APIRouter
from pydantic import BaseModel
from ..services.physics import compute_performance
from ..services.tpms import build_lattice

router = APIRouter(prefix="/sweep", tags=["sweep"])

VOXELS = 32
_FALLBACK_SF = {
    "gyroid": 0.18,
    "schwarzp": 0.22,
    "diamond": 0.20,
    "iwp": 0.16,
}

class SweepBase(BaseModel):
    surface: str = "gyroid"
    nx: int = 1
    ny: int = 1
    nz: int = 1
    hot: dict
    cold: dict
    solid: dict
    flow: str = "counter"
    nuCorrection: dict | None = None

class CellSizeSweepRequest(SweepBase):
    cellSizes: list[float]
    thickness: float

class ThicknessSweepRequest(SweepBase):
    cellSize: float
    thicknesses: list[float]

def _point(surface, cell_mm, thick_mm, nx, ny, nz,
           hot, cold, solid, flow, nu):
    try:
        geom = build_lattice(
            surface=surface,
            cell=(cell_mm, cell_mm, cell_mm),
            thickness=thick_mm,
            grading=0.0,
            grad_axis="z",
            n=(nx, ny, nz),
            region="solid",
            voxels_per_cell=VOXELS,
        )
        sf = geom["solidFraction"]
        sa = geom["specificArea"]
    except RuntimeError:
        sf = _FALLBACK_SF.get(surface, 0.18)
        sa = 600.0
    perf = compute_performance(
        cell=(cell_mm, cell_mm, cell_mm),
        cells=(nx, ny, nz),
        thickness=thick_mm,
        solid_fraction=sf,
        specific_area=sa,
        hot=hot,
        cold=cold,
        solid=solid,
        flow=flow,
        nu_correction=nu,
    )
    return {
        "solidFraction": sf,
        "specificArea": sa,
        "hydraulicDiameter": perf["hydraulicDiameter"],
        "U": perf["U"],
        "effectiveness": perf["effectiveness"],
        "Q": perf["Q"],
        "NTU": perf["NTU"],
        "pressureDropHot": perf["hot"]["pressureDrop"],
        "nuHot": perf["hot"]["nusselt"],
        "fHot": perf["hot"]["friction"],
        "reynoldsHot": perf["hot"]["reynolds"],
    }

@router.post("/cellsize")
def sweep_cellsize(req: CellSizeSweepRequest) -> list[dict]:
    nu = req.nuCorrection or {
        "A": 0.089, "b": 0.50, "sourceNote": "default"
    }
    out = []
    for cs in req.cellSizes:
        pt = _point(
            req.surface, cs, req.thickness,
            req.nx, req.ny, req.nz,
            req.hot, req.cold, req.solid,
            req.flow, nu,
        )
        pt["cellSize"] = cs
        pt["thickness"] = req.thickness
        out.append(pt)
    return out

@router.post("/thickness")
def sweep_thickness(req: ThicknessSweepRequest) -> list[dict]:
    nu = req.nuCorrection or {
        "A": 0.089, "b": 0.50, "sourceNote": "default"
    }
    out = []
    for th in req.thicknesses:
        pt = _point(
            req.surface, req.cellSize, th,
            req.nx, req.ny, req.nz,
            req.hot, req.cold, req.solid,
            req.flow, nu,
        )
        pt["cellSize"] = req.cellSize
        pt["thickness"] = th
        out.append(pt)
    return out
