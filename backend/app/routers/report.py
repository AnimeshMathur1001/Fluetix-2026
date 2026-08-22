"""POST /report — real multi-page PDF design report. Always includes real
geometry (regenerated via the same marching-cubes extraction used elsewhere)
and a server-recomputed analytical performance model; includes real solved
contours and solved-field performance too when a completed solve is on
record (services/job_state.py) for this session's case — otherwise that
section is clearly labelled absent rather than faked. See
services/report_pdf.py for the template."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response

from ..schemas import ReportRequest
from ..services import job_state
from ..services.report_pdf import build_report_pdf

router = APIRouter(tags=["report"])


@router.post("/report")
def report(req: ReportRequest, session: str | None = Query(None)) -> Response:
    state = job_state.get_session(session)
    try:
        pdf_bytes = build_report_pdf(req.model_dump(), state.active_case_dir)
    except Exception as exc:  # noqa: BLE001 — surfaced to the caller, not swallowed
        raise HTTPException(status_code=500, detail=f"report generation failed: {exc}") from exc

    filename = (req.caseName or "heat-exchanger-report").replace(" ", "_") + ".pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
