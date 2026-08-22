from fastapi import APIRouter, HTTPException, Query

from ..schemas import FluidListResponse, PropertiesResponse
from ..services.fluid_properties import evaluate_fluid, list_fluids

router = APIRouter(tags=["properties"])


@router.get("/fluids", response_model=FluidListResponse)
def fluids() -> FluidListResponse:
    """Every fluid /properties can genuinely evaluate — the full CoolProp fluid
    list (~136 real equations of state) plus the two legacy blend/correlation
    entries. Frontend fetches this once to populate the searchable material picker."""
    return FluidListResponse(fluids=list_fluids())


@router.get("/properties", response_model=PropertiesResponse)
def properties(
    fluid: str = Query(..., description="Any key from GET /fluids"),
    T: float = Query(..., description="Temperature, degC"),
    P: float = Query(101325.0, description="Pressure, Pa (absolute)"),
) -> PropertiesResponse:
    state = evaluate_fluid(fluid, T, P)
    if state is None:
        raise HTTPException(status_code=404, detail=f"unknown fluid {fluid!r}")
    return PropertiesResponse(**state)
