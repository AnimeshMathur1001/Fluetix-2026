"""POST /estimate — an instant performance estimate from this server's own
real solve history (services/surrogate.py), and GET /design-history/stats —
how much history actually backs it. Both real, neither a physics simulation:
see surrogate.py's docstring for exactly what the estimate is and isn't.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..schemas import DesignHistoryStats, EstimateRequest, EstimateResponse
from ..services import design_history, surrogate

router = APIRouter(tags=["estimate"])


@router.post("/estimate", response_model=EstimateResponse)
def estimate(req: EstimateRequest) -> EstimateResponse:
    params = {
        "cellX": req.cellX,
        "cellY": req.cellY,
        "cellZ": req.cellZ,
        "thickness": req.thickness,
        "grading": req.grading,
        "hot": req.hot.model_dump(),
        "cold": req.cold.model_dump(),
        "solid": req.solid.model_dump(),
    }
    result = surrogate.estimate(req.surface, params)
    if result is None:
        have = len(design_history.for_surface(req.surface))
        raise HTTPException(
            status_code=409,
            detail=f"not enough solved history for {req.surface} yet — have {have}, need {surrogate.MIN_RECORDS}",
        )
    return EstimateResponse(**result)


@router.get("/design-history/stats", response_model=DesignHistoryStats)
def history_stats() -> DesignHistoryStats:
    return DesignHistoryStats(**design_history.stats())
