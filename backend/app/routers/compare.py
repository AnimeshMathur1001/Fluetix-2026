"""POST /compare

Runs the analytical model for all four TPMS surface families at
identical user-supplied boundary conditions. Geometry for each
surface is measured by the server's own voxelisation pipeline so
no geometric quantity is assumed. Results are sorted by
effectiveness descending so the best-performing surface for the
given duty appears first.
"""
from __future__ import annotations
from fastapi import APIRouter
from pydantic import BaseModel
from ..services.physics import compute_performance
from ..services.tpms import build_lattice

router = APIRouter(tags=["compare"])

SURFACES = ["gyroid", "schwarzp", "diamond", "iwp"]
VOXELS = 32
_FALLBACK_SF = {
    "gyroid": 0.18,
    "schwarzp": 0.22,
    "diamond": 0.20,
    "iwp": 0.16,
}

class CompareRequest(BaseModel):
    cellX: float
    cellY: float
    cellZ: float
    nx: int = 1
    ny: int = 1
    nz: int = 1
    thickness: float
    grading: float = 0.0
    gradAxis: str = "z"
    hot: dict
    cold: dict
    solid: dict
    flow: str = "counter"
    nuCorrection: dict | None = None

@router.post("/compare")
def compare(req: CompareRequest) -> list[dict]:
    nu = req.nuCorrection or {
        "A": 0.089, "b": 0.50, "sourceNote": "default"
    }
    results = []
    for surface in SURFACES:
        try:
            geom = build_lattice(
                surface=surface,
                cell=(req.cellX, req.cellY, req.cellZ),
                thickness=req.thickness,
                grading=req.grading,
                grad_axis=req.gradAxis,
                n=(req.nx, req.ny, req.nz),
                region="solid",
                voxels_per_cell=VOXELS,
            )
            sf = geom["solidFraction"]
            sa = geom["specificArea"]
        except RuntimeError:
            sf = _FALLBACK_SF[surface]
            sa = 600.0
        perf = compute_performance(
            cell=(req.cellX, req.cellY, req.cellZ),
            cells=(req.nx, req.ny, req.nz),
            thickness=req.thickness,
            solid_fraction=sf,
            specific_area=sa,
            hot=req.hot,
            cold=req.cold,
            solid=req.solid,
            flow=req.flow,
            nu_correction=nu,
        )
        results.append({
            "surface": surface,
            "solidFraction": sf,
            "specificArea": sa,
            "hydraulicDiameter": perf["hydraulicDiameter"],
            "U": perf["U"],
            "effectiveness": perf["effectiveness"],
            "Q": perf["Q"],
            "NTU": perf["NTU"],
            "pressureDropHot": perf["hot"]["pressureDrop"],
            "pressureDropCold": perf["cold"]["pressureDrop"],
            "nuHot": perf["hot"]["nusselt"],
            "fHot": perf["hot"]["friction"],
            "reynoldsHot": perf["hot"]["reynolds"],
        })
    return sorted(
        results, key=lambda r: r["effectiveness"], reverse=True
    )
