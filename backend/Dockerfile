# Real OpenFOAM baked in (not WSL/exec bridging) — chtMultiRegionSimpleFoam,
# snappyHexMesh, blockMesh, checkMesh all live on PATH inside this image via
# the base image's /openfoam/run entrypoint, which this Dockerfile keeps.
FROM opencfd/openfoam-run:2606

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       python3 python3-pip \
       # WeasyPrint's real system deps (HTML/CSS -> PDF rendering for
       # POST /report) — no fallback here, the PDF report is real or absent.
       libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 \
       libffi-dev shared-mime-info fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages \
    -r requirements.txt scikit-image CoolProp matplotlib weasyprint jinja2

COPY app ./app

EXPOSE 8000
# --app-dir is required: the base image's /openfoam/run entrypoint (kept
# intact so OpenFOAM's env gets sourced) changes the working directory away
# from WORKDIR before exec'ing this command, so cwd can't be relied on for
# module resolution.
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "/app"]
