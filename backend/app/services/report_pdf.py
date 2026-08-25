"""Assembles the multi-page PDF design report: real geometry (regenerated via
the same marching-cubes tpms.build_lattice extraction used everywhere else in
this app, not a mock), real mesh/solve numbers already known to the caller,
the real analytical epsilon-NTU performance model (recomputed server-side,
not trusted verbatim from the client), and — when a real solve is on record
— genuine solved-field contours and boundary-derived performance metrics.
Sections that need a completed solve are simply omitted, with a clear note,
when none is available; nothing is fabricated to fill a gap.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from jinja2 import Template
from weasyprint import HTML

from . import physics
from .foam_field import FieldUnavailable
from .foam_metrics import solved_performance
from .report_render import (
    render_contour,
    render_fluid_property_plot,
    render_geometry_views,
    render_residual_chart,
    render_solid_property_plot,
)
from .tpms import build_lattice

REPORT_VOXELS = 28  # illustrative resolution for the report's own geometry images — independent of STL_VOXELS (48), which is what actually gets meshed.

REGION_COLOR = {"solid": "#c9ced4", "hot": "#e2603f", "cold": "#4aa8d8"}
REGION_ALPHA = {"solid": 0.95, "hot": 0.35, "cold": 0.35}

_FIELD_LABEL = {"temperature": "Temperature", "velocity": "Velocity magnitude", "pressure": "Pressure"}
_FIELD_UNIT = {"temperature": "°C", "velocity": "m/s", "pressure": "Pa"}
_CONTOUR_TARGETS: list[tuple[str, str]] = [
    ("solid", "temperature"),
    ("hot", "temperature"),
    ("cold", "temperature"),
    ("hot", "velocity"),
    ("cold", "velocity"),
    ("hot", "pressure"),
    ("cold", "pressure"),
]


def _region_geometry(req: dict) -> dict[str, dict]:
    out = {}
    for region in ("solid", "hot", "cold"):
        result = build_lattice(
            req["surface"],
            (req["cellX"], req["cellY"], req["cellZ"]),
            req["thickness"],
            req["grading"],
            req["gradAxis"],
            (req["nx"], req["ny"], req["nz"]),
            region,
            REPORT_VOXELS,
        )
        positions = np.array(result["positions"], dtype=np.float64).reshape(-1, 3)
        indices = np.array(result["indices"], dtype=np.int64).reshape(-1, 3)
        out[region] = {
            "positions": positions,
            "indices": indices,
            "color": REGION_COLOR[region],
            "alpha": REGION_ALPHA[region],
            "stats": result,
        }
    return out


def _analytical_performance(req: dict, solid_stats: dict, nu_correction: dict) -> dict:
    perf = physics.compute_performance(
        cell=(req["cellX"], req["cellY"], req["cellZ"]),
        cells=(req["nx"], req["ny"], req["nz"]),
        thickness=req["thickness"],
        solid_fraction=solid_stats["solidFraction"],
        specific_area=solid_stats["specificArea"],
        hot=req["hot"],
        cold=req["cold"],
        solid=req["solid"],
        flow=req["flow"],
        nu_correction=nu_correction,
    )

    from .physics import compute_exergy
    from .solid_properties import estimate_burst_pressure

    exergy = compute_exergy(perf, req["hot"], req["cold"],
                            T0_c=25.0)

    cell_min = min(req["cellX"], req["cellY"], req["cellZ"])
    burst = estimate_burst_pressure(
        req.get("solid", {}).get("mat", ""),
        req.get("surface", "gyroid"),
        cell_min,
        req["thickness"],
    )

    perf["exergy"] = exergy
    perf["burst"] = burst
    return perf


def _solved_section(case_dir: Path | None, req: dict, geometry: dict[str, dict]) -> dict | None:
    if case_dir is None or not case_dir.exists():
        return None
    try:
        performance = solved_performance(case_dir, req["faces"], req["hot"], req["cold"])
    except FieldUnavailable:
        return None

    contours = []
    for region, field in _CONTOUR_TARGETS:
        try:
            img, lo, hi, time = render_contour(case_dir, region, field, geometry[region]["positions"], geometry[region]["indices"])
        except FieldUnavailable:
            continue
        contours.append({
            "region": region,
            "field": _FIELD_LABEL[field],
            "unit": _FIELD_UNIT[field],
            "image": img,
            "min": lo,
            "max": hi,
            "time": time,
        })

    return {"performance": performance, "contours": contours, "time": performance["time"]}


def build_report_pdf(req: dict, case_dir: Path | None) -> bytes:
    nu_correction_value = req.get("nuCorrection") or {"A": 0.089, "b": 0.50, "sourceNote": "default"}

    geometry = _region_geometry(req)
    geometry_views = render_geometry_views({k: {kk: vv for kk, vv in v.items() if kk != "stats"} for k, v in geometry.items()})
    solid_stats = geometry["solid"]["stats"]
    analytical = _analytical_performance(req, solid_stats, nu_correction_value)
    solved = _solved_section(case_dir, req, geometry)

    residual_chart = None
    if req.get("residuals"):
        target = req.get("residualTarget") or 1e-4
        residual_chart = render_residual_chart(req["residuals"], target)

    property_plots = {
        "hot": render_fluid_property_plot(req["hot"]["fluid"], 101325 + req["hot"]["pOut"], req["hot"]["Tin"], "#e2603f"),
        "cold": render_fluid_property_plot(req["cold"]["fluid"], 101325 + req["cold"]["pOut"], req["cold"]["Tin"], "#4aa8d8"),
        "solid": render_solid_property_plot(req["solid"]["mat"]),
    }

    scale_up = None
    if req.get("core"):
        scale_up = physics.compute_scale_up(
            analytical,
            req["core"],
            (req["cellX"], req["cellY"], req["cellZ"]),
            req["thickness"],
            req["hot"],
            req["cold"],
            req["solid"],
            req["flow"],
            nu_correction_value,
        )

    html = TEMPLATE.render(
        now=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        req=req,
        geometry_views=geometry_views,
        solid_stats=solid_stats,
        hot_stats=geometry["hot"]["stats"],
        cold_stats=geometry["cold"]["stats"],
        analytical=analytical,
        solved=solved,
        residual_chart=residual_chart,
        property_plots=property_plots,
        mesh=req.get("mesh"),
        mesh_independence=req.get("meshIndependence"),
        mesh_independence_convergence=req.get("meshIndependenceConvergence"),
        core=req.get("core"),
        scale_up=scale_up,
        manufacturability=req.get("manufacturability"),
        nu_correction=nu_correction_value,
    )
    return HTML(string=html).write_pdf()


TEMPLATE = Template(r"""
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page {
    size: A4;
    margin: 20mm 16mm 18mm 16mm;
    @bottom-center { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; color: #888; }
    @bottom-left { content: "{{ req.caseName }}"; font-size: 8pt; color: #888; }
    @bottom-right { content: "Fluetix – A. Mathur, A. K. Singh, A. Gupta"; font-size: 8pt; color: #888; }
  }
  * { box-sizing: border-box; }
  body { font-family: "Liberation Serif", Georgia, serif; color: #1a1a1a; font-size: 10.5pt; line-height: 1.45; }
  h1 { font-size: 22pt; margin: 0 0 4pt 0; font-family: "Liberation Sans", Arial, sans-serif; }
  h2 {
    font-size: 13pt; margin: 18pt 0 8pt 0; padding-bottom: 3pt;
    border-bottom: 1.4pt solid #2b3a4a; font-family: "Liberation Sans", Arial, sans-serif;
    color: #1c2e40; page-break-after: avoid;
  }
  h3 { font-size: 10.5pt; margin: 10pt 0 4pt 0; font-family: "Liberation Sans", Arial, sans-serif; color: #33475a; }
  .subtitle { font-size: 11pt; color: #555; font-family: "Liberation Sans", Arial, sans-serif; }
  .cover { text-align: center; padding-top: 70mm; }
  .cover h1 { font-size: 28pt; }
  .cover .tag { margin-top: 6pt; font-size: 12pt; color: #444; }
  .cover .meta { margin-top: 40pt; font-size: 10pt; color: #666; font-family: "Liberation Sans", Arial, sans-serif; }
  .pagebreak { page-break-before: always; }
  table { width: 100%; border-collapse: collapse; margin: 6pt 0 12pt 0; font-size: 9.5pt; }
  th, td { border: 0.6pt solid #cfd6dc; padding: 4pt 7pt; text-align: left; }
  th { background: #eef2f5; font-family: "Liberation Sans", Arial, sans-serif; font-weight: 700; font-size: 9pt; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .grid6 { display: flex; flex-wrap: wrap; gap: 6pt; margin: 8pt 0; }
  .grid6 figure { width: 31%; margin: 0; text-align: center; }
  .grid6 img { width: 100%; border: 0.6pt solid #cfd6dc; }
  .grid6 figcaption { font-size: 8pt; color: #555; margin-top: 2pt; font-family: "Liberation Sans", Arial, sans-serif; }
  .contour { margin: 10pt 0; page-break-inside: avoid; }
  .contour img { width: 62%; display: block; margin: 0 auto; }
  .contour .cap { text-align: center; font-size: 9pt; color: #444; font-family: "Liberation Sans", Arial, sans-serif; }
  .note { font-size: 8.5pt; color: #777; font-family: "Liberation Sans", Arial, sans-serif; margin-top: 4pt; }
  .flag-ok { color: #1a7a4c; font-weight: 700; }
  .flag-warn { color: #a66a00; font-weight: 700; }
  .flag-bad { color: #b3261e; font-weight: 700; }
  .section-missing { color: #888; font-style: italic; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8pt; margin: 10pt 0 4pt 0; }
  .kpi { flex: 1 1 28%; min-width: 90pt; border: 0.6pt solid #cfd6dc; border-radius: 3pt; padding: 7pt 9pt; }
  .kpi .lbl { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: #777; font-family: "Liberation Sans", Arial, sans-serif; }
  .kpi .val { font-size: 14pt; font-weight: 700; margin-top: 2pt; font-family: "Liberation Sans", Arial, sans-serif; color: #1c2e40; }
  .kpi .sub { font-size: 8pt; color: #888; margin-top: 1pt; }
  .toc { margin: 10pt 0; }
  .toc-row { display: flex; font-size: 10pt; padding: 3pt 0; border-bottom: 0.4pt dotted #cfd6dc; }
  .toc-row .num { width: 20pt; color: #777; font-family: "Liberation Sans", Arial, sans-serif; }
  .toc-row .lbl { flex: 1; }
  .compare-delta { font-size: 8pt; color: #888; }
</style>
</head>
<body>

<div class="cover">
  <h1>TPMS Gyroid Heat Exchanger</h1>
  <div class="subtitle">Design &amp; CFD Verification Report</div>
  <div class="tag">{{ req.caseName }}</div>
  <div class="meta">
    Generated {{ now }}<br>
    {{ req.surface|capitalize }} lattice &middot; {{ req.cellX }}&times;{{ req.cellY }}&times;{{ req.cellZ }} mm unit cell
    &middot; {{ req.nx }}&times;{{ req.ny }}&times;{{ req.nz }} array<br>
    Hot: {{ req.hot.fluid }} @ {{ req.hot.Tin }} &deg;C &middot; Cold: {{ req.cold.fluid }} @ {{ req.cold.Tin }} &deg;C &middot;
    Solid: {{ req.solid.mat }}<br>
    {% if solved %}Includes real solved-field results (t={{ solved.time }}).
    {% else %}Analytical (&epsilon;-NTU) model only – no completed solve on record for this case.{% endif %}<br>
    Fluetix &middot; Author: Animesh Mathur &middot; Co-Authors: Arihant Kumar Singh, Aviral Gupta
  </div>

  <div class="kpis" style="text-align:left;margin-top:36pt;">
    <div class="kpi">
      <div class="lbl">Heat duty Q</div>
      <div class="val">{{ "%.1f"|format(analytical.Q) }} W</div>
      <div class="sub">{% if solved %}solved: {{ "%.1f"|format((solved.performance.Qhot + solved.performance.Qcold) / 2) }} W{% else %}analytical (&epsilon;-NTU){% endif %}</div>
    </div>
    <div class="kpi">
      <div class="lbl">Effectiveness &epsilon;</div>
      <div class="val">{{ "%.1f"|format(analytical.effectiveness * 100) }}%</div>
      <div class="sub">{% if solved %}solved: {{ "%.1f"|format(solved.performance.effectiveness * 100) }}%{% else %}analytical (&epsilon;-NTU){% endif %}</div>
    </div>
    <div class="kpi">
      <div class="lbl">&Delta;p hot / cold</div>
      <div class="val">{{ "%.0f"|format(analytical.hot.pressureDrop) }} / {{ "%.0f"|format(analytical.cold.pressureDrop) }} Pa</div>
      <div class="sub">{% if solved %}solved: {{ "%.0f"|format(solved.performance.hot.pressureDrop) }} / {{ "%.0f"|format(solved.performance.cold.pressureDrop) }} Pa{% else %}analytical (&epsilon;-NTU){% endif %}</div>
    </div>
    <div class="kpi">
      <div class="lbl">CFD solve</div>
      <div class="val">{% if req.converged %}<span class="flag-ok">Converged</span>{% elif req.converged is sameas false %}<span class="flag-bad">Not converged</span>{% elif solved %}Ran{% else %}Not run{% endif %}</div>
      <div class="sub">{% if req.iteration is not none %}{{ req.iteration }} iterations{% else %}analytical estimate only{% endif %}</div>
    </div>
    {% if manufacturability %}
    <div class="kpi">
      <div class="lbl">Manufacturability</div>
      <div class="val">
        {% set worst = 'bad' if manufacturability|selectattr('severity','equalto','bad')|list|length > 0 else ('warn' if manufacturability|selectattr('severity','equalto','warn')|list|length > 0 else 'ok') %}
        <span class="flag-{{ worst }}">{{ {'ok': 'No issues', 'warn': 'Caution', 'bad': 'Issues found'}[worst] }}</span>
      </div>
      <div class="sub">{{ manufacturability|length }} check(s) – see Section 5</div>
    </div>
    {% endif %}
    {% if scale_up %}
    <div class="kpi">
      <div class="lbl">Full-scale Q</div>
      <div class="val">{{ "%.2f"|format(scale_up.Q / 1000) }} kW</div>
      <div class="sub">{{ scale_up.parallel }}&times;{{ scale_up.series }} cells – see Section 6</div>
    </div>
    {% endif %}
  </div>
</div>

<div class="pagebreak"></div>

<h2>Contents</h2>
<div class="toc">
  <div class="toc-row"><div class="num">1</div><div class="lbl">Geometry &amp; Lattice Parameters</div></div>
  <div class="toc-row"><div class="num">2</div><div class="lbl">Geometry Views</div></div>
  {% if mesh %}<div class="toc-row"><div class="num">3</div><div class="lbl">Mesh Statistics</div></div>{% endif %}
  <div class="toc-row"><div class="num">4</div><div class="lbl">Analytical Performance (&epsilon;-NTU model)</div></div>
  {% if manufacturability %}<div class="toc-row"><div class="num">5</div><div class="lbl">Manufacturability</div></div>{% endif %}
  {% if scale_up %}<div class="toc-row"><div class="num">6</div><div class="lbl">Scale-Up &amp; Full-System Estimate</div></div>{% endif %}
  {% if solved %}
  <div class="toc-row"><div class="num">7</div><div class="lbl">CFD Solve Convergence</div></div>
  <div class="toc-row"><div class="num">8</div><div class="lbl">Solved-Field Contours (real CFD output)</div></div>
  <div class="toc-row"><div class="num">9</div><div class="lbl">Solved-Field Performance &amp; Comparison to Analytical</div></div>
  {% else %}
  <div class="toc-row"><div class="num">7</div><div class="lbl">CFD Solve &amp; Solved-Field Results</div></div>
  {% endif %}
  {% if mesh_independence %}<div class="toc-row"><div class="num">10</div><div class="lbl">Mesh Independence Study</div></div>{% endif %}
</div>

<div class="pagebreak"></div>

<h2>How to read this report</h2>
<p>This report has two kinds of numbers, and telling them apart matters more than any single
value in it. <b>Analytical</b> figures (Section 4) come from a closed-form &epsilon;-NTU heat-exchanger
correlation – fast, always available, and a reasonable design-stage estimate, but a model, not a
measurement. <b>Solved</b> figures (Sections 5&ndash;7, present only when a CFD run is on record) come
from a real conjugate-heat-transfer CFD solve of this exact geometry – slower to
obtain, but the closer of the two to what the physical part would actually do. When both are present
in a report, treat the solved numbers as the more trustworthy one; a large gap between them is worth
investigating (mesh too coarse, solve not fully converged, or an arrangement/flow assumption in the
analytical model that doesn't hold for this geometry), not something to average away.</p>
<p>A few numbers recur throughout and are worth knowing how to read on sight:
<b>Reynolds number</b> below ~2300 means laminar flow (the solver's laminar/turbulent model choice on
the Mesh &amp; Solve step should agree); <b>effectiveness &epsilon;</b> is bounded 0&ndash;1 and is the fraction of
the thermodynamically maximum possible heat transfer this exchanger actually achieves; <b>energy
imbalance</b> compares heat lost by the hot side against heat gained by the cold side and should be
small (a few percent) – a large imbalance in the solved section usually means the solve hasn't run
enough iterations yet, not a modelling error (see the note under Section 7). Every other section-level
caveat is disclosed in the small grey note under that section's own numbers, in the same spirit as
this paragraph – this report does not round off or hide the difference between a real result and an
estimate anywhere in it.</p>

<div class="pagebreak"></div>

<h2>1. Geometry &amp; Lattice Parameters</h2>
<table>
  <tr><th>Parameter</th><th class="num">Value</th></tr>
  <tr><td>Surface type</td><td class="num">{{ req.surface|capitalize }}</td></tr>
  <tr><td>Unit cell (X &times; Y &times; Z)</td><td class="num">{{ req.cellX }} &times; {{ req.cellY }} &times; {{ req.cellZ }} mm</td></tr>
  <tr><td>Wall thickness</td><td class="num">{{ req.thickness }} mm</td></tr>
  <tr><td>Grading</td><td class="num">{{ req.grading }} (axis {{ req.gradAxis|upper }})</td></tr>
  <tr><td>Array (nx &times; ny &times; nz)</td><td class="num">{{ req.nx }} &times; {{ req.ny }} &times; {{ req.nz }}</td></tr>
  <tr><td>Overall dimensions</td><td class="num">{{ "%.1f"|format(req.cellX*req.nx) }} &times; {{ "%.1f"|format(req.cellY*req.ny) }} &times; {{ "%.1f"|format(req.cellZ*req.nz) }} mm</td></tr>
  <tr><td>Solid volume fraction</td><td class="num">{{ "%.1f"|format(solid_stats.solidFraction*100) }} %</td></tr>
  <tr><td>Specific surface area</td><td class="num">{{ "%.0f"|format(solid_stats.specificArea) }} m&sup2;/m&sup3;</td></tr>
  <tr><td>Solid mesh triangles / vertices</td><td class="num">{{ "{:,}".format(solid_stats.triangles) }} / {{ "{:,}".format(solid_stats.vertices) }}</td></tr>
</table>

<h3>Boundary face assignment</h3>
<table>
  <tr><th>Face</th><th>Role</th></tr>
  {% for face, role in req.faces.items() %}
  <tr><td>{{ face }}</td><td>{{ role }}</td></tr>
  {% endfor %}
</table>
<div class="note">Periodic faces (role periodicA/periodicB) are modelled as adiabatic walls, a disclosed
approximation – not true cyclic boundary conditions.</div>

<h3>Fluid &amp; solid properties</h3>
<table>
  <tr><th>Property</th><th class="num">Hot</th><th class="num">Cold</th></tr>
  <tr><td>Fluid</td><td class="num">{{ req.hot.fluid }}</td><td class="num">{{ req.cold.fluid }}</td></tr>
  <tr><td>Inlet temperature</td><td class="num">{{ req.hot.Tin }} &deg;C</td><td class="num">{{ req.cold.Tin }} &deg;C</td></tr>
  <tr><td>Mass flow rate</td><td class="num">{{ req.hot.mdot }} kg/s</td><td class="num">{{ req.cold.mdot }} kg/s</td></tr>
  <tr><td>&rho;</td><td class="num">{{ "%.1f"|format(req.hot.rho) }} kg/m&sup3;</td><td class="num">{{ "%.1f"|format(req.cold.rho) }} kg/m&sup3;</td></tr>
  <tr><td>&mu;</td><td class="num">{{ "%.2e"|format(req.hot.mu) }} Pa&middot;s</td><td class="num">{{ "%.2e"|format(req.cold.mu) }} Pa&middot;s</td></tr>
  <tr><td>c<sub>p</sub></td><td class="num">{{ "%.0f"|format(req.hot.cp) }} J/kg&middot;K</td><td class="num">{{ "%.0f"|format(req.cold.cp) }} J/kg&middot;K</td></tr>
  <tr><td>k</td><td class="num">{{ "%.3f"|format(req.hot.k) }} W/m&middot;K</td><td class="num">{{ "%.3f"|format(req.cold.k) }} W/m&middot;K</td></tr>
</table>
<table>
  <tr><th>Solid material</th><th class="num">{{ req.solid.mat }}</th></tr>
  <tr><td>Thermal conductivity k</td><td class="num">{{ req.solid.k }} W/m&middot;K</td></tr>
  <tr><td>Density &rho;</td><td class="num">{{ req.solid.rho }} kg/m&sup3;</td></tr>
  <tr><td>Specific heat c<sub>p</sub></td><td class="num">{{ req.solid.cp }} J/kg&middot;K</td></tr>
</table>

{% if property_plots.hot or property_plots.cold %}
<h3>Fluid properties vs. temperature</h3>
<div class="note">Each curve is genuinely re-evaluated at that temperature and this stream's actual
operating pressure against a physical-property database, not interpolated cosmetically – swept
&plusmn;60&deg;C around the inlet temperature (dashed line) to show how much the property actually
moves across the exchanger, not just its value at one point.</div>
{% if property_plots.hot %}<img src="{{ property_plots.hot }}" style="width:100%;"><div class="note" style="text-align:center;margin-top:-4pt;">Hot stream – {{ req.hot.fluid }}</div>{% endif %}
{% if property_plots.cold %}<img src="{{ property_plots.cold }}" style="width:100%;margin-top:6pt;"><div class="note" style="text-align:center;margin-top:-4pt;">Cold stream – {{ req.cold.fluid }}</div>{% endif %}
{% endif %}
{% if property_plots.solid %}
<h3>Solid conductivity &amp; specific heat vs. temperature</h3>
<div class="note">Typical literature/datasheet trend for this alloy – not a certified per-batch spec, and
density is intentionally not shown as temperature-dependent (see Section 1's disclosure and the
Materials panel in the app).</div>
<img src="{{ property_plots.solid }}" style="width:60%;display:block;margin:0 auto;">
{% endif %}

<div class="pagebreak"></div>
<h2>2. Geometry Views</h2>
<div class="grid6">
  {% for name, img in geometry_views.items() %}
  <figure><img src="{{ img }}"><figcaption>{{ name }}</figcaption></figure>
  {% endfor %}
</div>
<div class="note">Rendered directly from the same marching-cubes surface extraction used to generate the
CFD case geometry (grey = solid lattice, red = hot channel, blue = cold channel).</div>

{% if mesh %}
<div class="pagebreak"></div>
<h2>3. Mesh Statistics</h2>
<table>
  <tr><th>Metric</th><th class="num">Value</th></tr>
  <tr><td>Total cells</td><td class="num">{{ "{:,}".format(mesh.cells) }}</td></tr>
  <tr><td>Hot / Cold / Solid cells</td><td class="num">{{ "{:,}".format(mesh.hot) }} / {{ "{:,}".format(mesh.cold) }} / {{ "{:,}".format(mesh.solid) }}</td></tr>
  <tr><td>Max skewness</td><td class="num">{{ "%.2f"|format(mesh.skewness) }}</td></tr>
  <tr><td>Max aspect ratio</td><td class="num">{{ "%.1f"|format(mesh.aspectRatio) }}</td></tr>
  <tr><td>Max non-orthogonality</td><td class="num">{{ "%.1f"|format(mesh.nonOrthogonality) }} &deg;</td></tr>
  <tr><td>Source</td><td class="num">{{ mesh.source }}</td></tr>
</table>
{% endif %}

<div class="pagebreak"></div>
<h2>4. Analytical Performance (&epsilon;-NTU model)</h2>
<div class="note">Closed-form correlation estimate, recomputed server-side from the geometry and fluid
properties above – independent of whether a CFD solve has been run.
Laminar Nusselt correction applied: Nu = 4.36 x
{{ nu_correction.A }} x Re^{{ nu_correction.b }}.
Source: {{ nu_correction.sourceNote }}.</div>
<table>
  <tr><th>Metric</th><th class="num">Hot</th><th class="num">Cold</th></tr>
  <tr><td>Velocity</td><td class="num">{{ "%.3f"|format(analytical.hot.velocity) }} m/s</td><td class="num">{{ "%.3f"|format(analytical.cold.velocity) }} m/s</td></tr>
  <tr><td>Reynolds number</td><td class="num">{{ "%.0f"|format(analytical.hot.reynolds) }}</td><td class="num">{{ "%.0f"|format(analytical.cold.reynolds) }}</td></tr>
  <tr>
    <td>Nusselt number Nu</td>
    <td class="num">
      {{ "%.2f"|format(analytical.hot.nusselt) }}
    </td>
    <td class="num">
      {{ "%.2f"|format(analytical.cold.nusselt) }}
    </td>
  </tr>
  <tr>
    <td>Friction factor f</td>
    <td class="num">
      {{ "%.5f"|format(analytical.hot.friction) }}
    </td>
    <td class="num">
      {{ "%.5f"|format(analytical.cold.friction) }}
    </td>
  </tr>
  <tr><td>Flow regime</td><td class="num">{{ "Laminar" if analytical.hot.laminar else "Turbulent" }}</td><td class="num">{{ "Laminar" if analytical.cold.laminar else "Turbulent" }}</td></tr>
  <tr><td>Pressure drop</td><td class="num">{{ "%.1f"|format(analytical.hot.pressureDrop) }} Pa</td><td class="num">{{ "%.1f"|format(analytical.cold.pressureDrop) }} Pa</td></tr>
  <tr><td>Outlet temperature</td><td class="num">{{ "%.2f"|format(analytical.ThOut) }} &deg;C</td><td class="num">{{ "%.2f"|format(analytical.TcOut) }} &deg;C</td></tr>
</table>
<table>
  <tr><th>Overall</th><th class="num">Value</th></tr>
  <tr><td>Hydraulic diameter D<sub>h</sub></td><td class="num">{{ "%.2f"|format(analytical.hydraulicDiameter*1000) }} mm</td></tr>
  <tr><td>Heat transfer area</td><td class="num">{{ "%.4f"|format(analytical.wallArea) }} m&sup2;</td></tr>
  <tr><td>UA</td><td class="num">{{ "%.2f"|format(analytical.UA) }} W/K</td></tr>
  <tr><td>NTU</td><td class="num">{{ "%.3f"|format(analytical.NTU) }}</td></tr>
  <tr><td>Effectiveness &epsilon;</td><td class="num">{{ "%.4f"|format(analytical.effectiveness) }}</td></tr>
  <tr><td>Heat duty Q</td><td class="num">{{ "%.2f"|format(analytical.Q) }} W</td></tr>
  <tr><td>Energy imbalance</td><td class="num">{{ "%.2f"|format(analytical.imbalance) }} %</td></tr>
</table>

{% if analytical.exergy %}
<h3>Second-Law Performance</h3>
<table>
  <tr><th>Metric</th><th class="num">Value</th></tr>
  <tr>
    <td>Exergy destruction</td>
    <td class="num">
      {{ "%.4f"|format(analytical.exergy.exergyDestroyed) }} W
    </td>
  </tr>
  <tr>
    <td>Second-law effectiveness &eta;<sub>II</sub></td>
    <td class="num">
      {{ "%.2f"|format(analytical.exergy.etaII * 100) }} %
    </td>
  </tr>
  <tr>
    <td>Entropy generation rate</td>
    <td class="num">
      {{ "%.6f"|format(analytical.exergy.sGen) }} W/K
    </td>
  </tr>
  <tr>
    <td>Entropy generation number N<sub>s</sub></td>
    <td class="num">
      {{ "%.6f"|format(analytical.exergy.Ns) }}
    </td>
  </tr>
  <tr>
    <td>Reference temperature T&#8320;</td>
    <td class="num">{{ "%.0f"|format(analytical.exergy.T0_c) }} &deg;C</td>
  </tr>
</table>
{% endif %}

{% if analytical.burst %}
<h3>Structural Screening</h3>
<div class="note">
  Thin-shell estimate only &mdash; verify with FEA before
  fabrication. Safety factor {{ analytical.burst.safetyFactor }}
  applied to material yield strength.
</div>
<table>
  <tr><th>Parameter</th><th class="num">Value</th></tr>
  <tr>
    <td>Material</td>
    <td class="num">{{ analytical.burst.mat }}</td>
  </tr>
  <tr>
    <td>Yield strength</td>
    <td class="num">
      {{ "%.0f"|format(analytical.burst.yieldMPa) }} MPa
    </td>
  </tr>
  <tr>
    <td>Wall thickness</td>
    <td class="num">
      {{ "%.2f"|format(analytical.burst.thicknessMm) }} mm
    </td>
  </tr>
  <tr>
    <td>Min. curvature radius R<sub>min</sub></td>
    <td class="num">
      {{ "%.3f"|format(analytical.burst.rMinMm) }} mm
    </td>
  </tr>
  <tr>
    <td>Estimated burst pressure</td>
    <td class="num">
      {{ "%.0f"|format(analytical.burst.burstBar) }} bar
      &nbsp;/&nbsp;
      {{ "%.1f"|format(analytical.burst.burstMPa) }} MPa
    </td>
  </tr>
</table>
{% endif %}

{% if manufacturability %}
<div class="pagebreak"></div>
<h2>5. Manufacturability</h2>
<div class="note">Metal powder-bed (LPBF) printability checks against this exact generated geometry –
wall thickness is a general design guideline (not a certified per-machine/material spec), escape-path
detection is topological (from the boundary face roles above), and the overhang figure is computed
directly from the generated triangle mesh, not estimated.</div>
<table>
  <tr><th>Check</th><th>Result</th><th class="num">Status</th></tr>
  {% for c in manufacturability %}
  <tr>
    <td>{{ c.label }}</td>
    <td>{{ c.detail }}</td>
    <td class="num"><span class="flag-{{ c.severity }}">{{ c.value }}</span></td>
  </tr>
  {% endfor %}
</table>
{% endif %}

{% if scale_up %}
<div class="pagebreak"></div>
<h2>6. Scale-Up &amp; Full-System Estimate</h2>
<div class="note">Extrapolates the single simulated unit cell to a full core sized to the target
dimensions and total flow rates below – recomputed server-side from these raw inputs (not trusted
verbatim from the client), the same integrity reasoning as the analytical model in Section 4.
Entrance effects, manifold maldistribution and header pressure losses are excluded; &Delta;p scales
with series count, UA with total cell count, and effectiveness is recomputed from total NTU, not
multiplied.</div>
<table>
  <tr><th>Target core</th><th class="num">Value</th></tr>
  <tr><td>Width &times; Height &times; Length</td><td class="num">{{ "%.0f"|format(core.width) }} &times; {{ "%.0f"|format(core.height) }} &times; {{ "%.0f"|format(core.length) }} mm</td></tr>
  <tr><td>Total mass flow (hot / cold)</td><td class="num">{{ "%.3f"|format(core.mdotHot) }} / {{ "%.3f"|format(core.mdotCold) }} kg/s</td></tr>
</table>
<table>
  <tr><th>Cell array</th><th class="num">Value</th></tr>
  <tr><td>Parallel (width &times; height)</td><td class="num">{{ scale_up.parallelX }} &times; {{ scale_up.parallelY }} = {{ scale_up.parallel }}</td></tr>
  <tr><td>Series (length)</td><td class="num">{{ scale_up.series }}</td></tr>
  <tr><td>Total cells</td><td class="num">{{ "{:,}".format(scale_up.totalCells) }}</td></tr>
  <tr><td>Heat transfer area</td><td class="num">{{ "%.2f"|format(scale_up.area) }} m&sup2;</td></tr>
  <tr><td>Core volume</td><td class="num">{{ "%.2f"|format(scale_up.coreVolume * 1000) }} L</td></tr>
</table>
<table>
  <tr><th>Full-scale estimate</th><th class="num">Value</th></tr>
  <tr><td>&Delta;p hot</td><td class="num">{{ "%.2f"|format(scale_up.pressureDropHot / 1000) }} kPa</td></tr>
  <tr><td>&Delta;p cold</td><td class="num">{{ "%.2f"|format(scale_up.pressureDropCold / 1000) }} kPa</td></tr>
  <tr><td>Heat duty Q</td><td class="num">{{ "%.2f"|format(scale_up.Q / 1000) }} kW</td></tr>
  <tr><td>Overall U</td><td class="num">{{ "%.0f"|format(scale_up.U) }} W/m&sup2;K</td></tr>
  <tr><td>UA</td><td class="num">{{ "%.1f"|format(scale_up.UA) }} W/K</td></tr>
  <tr><td>NTU</td><td class="num">{{ "%.3f"|format(scale_up.NTU) }}</td></tr>
  <tr><td>Effectiveness &epsilon;</td><td class="num">{{ "%.4f"|format(scale_up.effectiveness) }}</td></tr>
  <tr><td>Outlet temperature (hot / cold)</td><td class="num">{{ "%.1f"|format(scale_up.ThOut) }} / {{ "%.1f"|format(scale_up.TcOut) }} &deg;C</td></tr>
  <tr><td>Pumping power</td><td class="num">{{ "%.1f"|format(scale_up.pumpingPower) }} W</td></tr>
  <tr><td>Power density</td><td class="num">{{ "%.2f"|format(scale_up.powerDensity) }} kW/L</td></tr>
</table>
{% endif %}

{% if solved %}
<div class="pagebreak"></div>
<h2>7. CFD Solve Convergence</h2>
{% if residual_chart %}<img src="{{ residual_chart }}" style="width:100%;"><br>{% endif %}
<table>
  <tr><th>Metric</th><th class="num">Value</th></tr>
  <tr><td>Iterations run</td><td class="num">{{ req.iteration if req.iteration is not none else "–" }}</td></tr>
  <tr><td>Converged (all residuals incl. solid)</td>
      <td class="num">{% if req.converged %}<span class="flag-ok">yes</span>{% elif req.converged is sameas false %}<span class="flag-bad">no</span>{% else %}–{% endif %}</td></tr>
  <tr><td>Latest solved time</td><td class="num">{{ solved.time }}</td></tr>
</table>

<div class="pagebreak"></div>
<h2>8. Solved-Field Contours (real CFD output)</h2>
{% for c in solved.contours %}
<div class="contour">
  <img src="{{ c.image }}">
  <div class="cap">{{ c.region|capitalize }} – {{ c.field }} · range {{ "%.3g"|format(c.min) }} – {{ "%.3g"|format(c.max) }} {{ c.unit }} (t={{ c.time }})</div>
</div>
{% endfor %}
<div class="note">Sampled onto each region's real triangulated surface from its nearest solved cell
centre – not interpolated. Solid region has no real solved U or p (no momentum equation there /
inert placeholder field), so those combinations are omitted rather than shown as fabricated data.</div>

<div class="pagebreak"></div>
<h2>9. Solved-Field Performance (boundary-derived, real)</h2>
<div class="note">Computed from the solver's own real boundary-patch values at the inlet/outlet faces of
the latest solved time – a plain (not area-weighted) mean of each patch's actual face values, a
disclosed approximation.</div>
<table>
  <tr><th>Metric</th><th class="num">Hot</th><th class="num">Cold</th></tr>
  <tr><td>Inlet temperature</td><td class="num">{{ "%.2f"|format(solved.performance.hot.TinC) }} &deg;C</td><td class="num">{{ "%.2f"|format(solved.performance.cold.TinC) }} &deg;C</td></tr>
  <tr><td>Outlet temperature</td><td class="num">{{ "%.2f"|format(solved.performance.hot.ToutC) }} &deg;C</td><td class="num">{{ "%.2f"|format(solved.performance.cold.ToutC) }} &deg;C</td></tr>
  <tr><td>Pressure drop</td><td class="num">{{ "%.1f"|format(solved.performance.hot.pressureDrop) }} Pa</td><td class="num">{{ "%.1f"|format(solved.performance.cold.pressureDrop) }} Pa</td></tr>
  <tr><td>Inlet velocity</td><td class="num">{{ "%.3f"|format(solved.performance.hot.velocityIn) }} m/s</td><td class="num">{{ "%.3f"|format(solved.performance.cold.velocityIn) }} m/s</td></tr>
  <tr><td>Outlet velocity</td><td class="num">{{ "%.3f"|format(solved.performance.hot.velocityOut) }} m/s</td><td class="num">{{ "%.3f"|format(solved.performance.cold.velocityOut) }} m/s</td></tr>
</table>
<table>
  <tr><th>Overall</th><th class="num">Value</th></tr>
  <tr><td>Heat duty (hot side)</td><td class="num">{{ "%.2f"|format(solved.performance.Qhot) }} W</td></tr>
  <tr><td>Heat duty (cold side)</td><td class="num">{{ "%.2f"|format(solved.performance.Qcold) }} W</td></tr>
  <tr><td>Energy imbalance</td><td class="num">{{ "%.1f"|format(solved.performance.imbalance) }} %</td></tr>
  <tr><td>Effectiveness &epsilon;</td><td class="num">{{ "%.4f"|format(solved.performance.effectiveness) }}</td></tr>
  <tr><td>Solid temperature range</td><td class="num">{{ "%.2f"|format(solved.performance.solidTminC) }} – {{ "%.2f"|format(solved.performance.solidTmaxC) }} &deg;C</td></tr>
</table>
<div class="note">A high energy imbalance or a narrow solid temperature range can mean the solve has not
run enough iterations – the solid region's own energy equation settles far slower than the fluid
side – but it can equally mean too few mesh cells span the wall thickness, which more iterations
will not fix. If imbalance stays high across a range of iteration counts, check mesh resolution
(background cells) before suspecting the model itself.</div>

<h3>Analytical vs. solved – side by side</h3>
<div class="note">Per this report's reading guide: a real gap here is worth investigating, not averaging
away. Percentages below are (solved &minus; analytical) / analytical.</div>
<table>
  <tr><th>Metric</th><th class="num">Analytical</th><th class="num">Solved</th><th class="num">Difference</th></tr>
  <tr>
    <td>&Delta;p hot</td>
    <td class="num">{{ "%.1f"|format(analytical.hot.pressureDrop) }} Pa</td>
    <td class="num">{{ "%.1f"|format(solved.performance.hot.pressureDrop) }} Pa</td>
    <td class="num compare-delta">{{ "%+.1f"|format((solved.performance.hot.pressureDrop - analytical.hot.pressureDrop) / analytical.hot.pressureDrop * 100) }}%</td>
  </tr>
  <tr>
    <td>&Delta;p cold</td>
    <td class="num">{{ "%.1f"|format(analytical.cold.pressureDrop) }} Pa</td>
    <td class="num">{{ "%.1f"|format(solved.performance.cold.pressureDrop) }} Pa</td>
    <td class="num compare-delta">{{ "%+.1f"|format((solved.performance.cold.pressureDrop - analytical.cold.pressureDrop) / analytical.cold.pressureDrop * 100) }}%</td>
  </tr>
  <tr>
    <td>Outlet temperature (hot)</td>
    <td class="num">{{ "%.2f"|format(analytical.ThOut) }} &deg;C</td>
    <td class="num">{{ "%.2f"|format(solved.performance.hot.ToutC) }} &deg;C</td>
    <td class="num compare-delta">{{ "%+.2f"|format(solved.performance.hot.ToutC - analytical.ThOut) }} &deg;C</td>
  </tr>
  <tr>
    <td>Outlet temperature (cold)</td>
    <td class="num">{{ "%.2f"|format(analytical.TcOut) }} &deg;C</td>
    <td class="num">{{ "%.2f"|format(solved.performance.cold.ToutC) }} &deg;C</td>
    <td class="num compare-delta">{{ "%+.2f"|format(solved.performance.cold.ToutC - analytical.TcOut) }} &deg;C</td>
  </tr>
  <tr>
    <td>Effectiveness &epsilon;</td>
    <td class="num">{{ "%.4f"|format(analytical.effectiveness) }}</td>
    <td class="num">{{ "%.4f"|format(solved.performance.effectiveness) }}</td>
    <td class="num compare-delta">{{ "%+.1f"|format((solved.performance.effectiveness - analytical.effectiveness) / analytical.effectiveness * 100) }}%</td>
  </tr>
</table>
{% else %}
<div class="pagebreak"></div>
<h2>7. CFD Solve &amp; Solved-Field Results</h2>
<p class="section-missing">No completed solve is on record for this case – this report contains
the analytical estimate only. Run Mesh &amp; Solve, then regenerate this report, to include real
solved-field contours and boundary-derived performance.</p>
{% endif %}

{% if mesh_independence %}
<div class="pagebreak"></div>
<h2>10. Mesh Independence Study</h2>
<table>
  <tr><th>bgCells</th><th class="num">Cells</th><th class="num">&Delta;p hot [Pa]</th><th class="num">&Delta;p cold [Pa]</th><th class="num">Effectiveness</th></tr>
  {% for lv in mesh_independence %}
  <tr>
    <td>{{ lv.level }}</td>
    <td class="num">{{ "{:,}".format(lv.cells) }}</td>
    <td class="num">{{ "%.1f"|format(lv.performance.hot.pressureDrop) }}</td>
    <td class="num">{{ "%.1f"|format(lv.performance.cold.pressureDrop) }}</td>
    <td class="num">{{ "%.4f"|format(lv.performance.effectiveness) }}</td>
  </tr>
  {% endfor %}
</table>
{% if mesh_independence_convergence %}
<h3>Convergence (% change between successive resolutions)</h3>
<table>
  <tr><th>Metric</th><th>% change</th></tr>
  {% for row in mesh_independence_convergence %}
  <tr><td>{{ row.metric }}</td><td>{{ row.percentChange|map("round", 1)|map("string")|join(" % → ") }} %</td></tr>
  {% endfor %}
</table>
{% endif %}
{% endif %}

</body>
</html>
""")
