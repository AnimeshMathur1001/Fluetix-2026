"""POST /cases/{id} stores a case, GET /results/{id} computes its performance.

README's contract table lists a single `GET /results/:case` — this splits it
into store + compute because a stateless scaffold has nowhere else to keep the
case between the front end's Case and Results steps. Collapse these back into
one endpoint if the real backend ends up persisting cases some other way
(database, the mesh/solve job record, etc).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..schemas import CaseRequest, Performance
from ..services.physics import compute_performance

router = APIRouter(tags=["results"])

_CASES: dict[str, CaseRequest] = {}


@router.post("/cases/{case_id}")
def put_case(case_id: str, req: CaseRequest) -> dict:
    _CASES[case_id] = req
    return {"ok": True}


@router.get("/results/{case_id}", response_model=Performance)
def results(case_id: str) -> Performance:
    case = _CASES.get(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"no case stored under id {case_id!r} — POST /cases/{case_id} first")

    perf = compute_performance(
        cell=case.cell,
        cells=case.cells,
        thickness=case.thickness,
        solid_fraction=case.solidFraction,
        specific_area=case.specificArea,
        hot=case.hot.model_dump(),
        cold=case.cold.model_dump(),
        solid=case.solid.model_dump(),
        flow=case.flow,
        nu_correction=case.nuCorrection,
    )
    return Performance(**perf, source="analytical")
