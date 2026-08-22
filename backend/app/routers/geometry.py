from fastapi import APIRouter, HTTPException

from ..schemas import GeometryResponse, LatticeRequest
from ..services.tpms import HAVE_SKIMAGE, build_lattice

router = APIRouter(prefix="/geometry", tags=["geometry"])


@router.post("/lattice", response_model=GeometryResponse)
def lattice(req: LatticeRequest) -> GeometryResponse:
    if not HAVE_SKIMAGE:
        raise HTTPException(
            status_code=501,
            detail="the server-side geometry engine isn't installed — see the server's own README",
        )
    result = build_lattice(
        surface=req.surface,
        cell=(req.cellX, req.cellY, req.cellZ),
        thickness=req.thickness,
        grading=req.grading,
        grad_axis=req.gradAxis,
        n=(req.nx, req.ny, req.nz),
        region=req.region,
        voxels_per_cell=req.voxelsPerCell,
    )
    return GeometryResponse(**result)
