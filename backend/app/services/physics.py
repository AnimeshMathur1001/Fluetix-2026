"""Port of src/lib/physics.ts computePerformance. This is the analytical
correlation model, not a solved field — see solve.py / results.py docstrings
for how a real chtMultiRegionSimpleFoam result would replace it."""
from __future__ import annotations

import math

TORTUOSITY = 1.35
LAMINAR_F = 1.45
ENERGY_IMBALANCE = 0.0042


def _apply_nu_correction(reynolds: float, nu: dict) -> float:
    return nu["A"] * max(1.0, reynolds) ** nu["b"]


def _side(fluid: dict, dh: float, cross_area: float, path_length: float, nu_correction: dict) -> dict:
    velocity = fluid["mdot"] / (fluid["rho"] * cross_area)
    reynolds = (fluid["rho"] * velocity * dh) / fluid["mu"]
    prandtl = (fluid["mu"] * fluid["cp"]) / fluid["k"]
    laminar = reynolds < 2300
    if laminar:
        friction = (96 / max(reynolds, 1)) * LAMINAR_F
    else:
        friction = 0.316 * max(reynolds, 1) ** -0.25 * 1.6
    pressure_drop = (friction * (path_length / dh) * fluid["rho"] * velocity * velocity) / 2
    if laminar:
        nusselt = 4.36 * _apply_nu_correction(reynolds, nu_correction)
    else:
        nusselt = 0.023 * reynolds ** 0.8 * prandtl ** 0.4
    return {
        "velocity": velocity,
        "reynolds": reynolds,
        "prandtl": prandtl,
        "laminar": laminar,
        "friction": friction,
        "pressureDrop": pressure_drop,
        "nusselt": nusselt,
        "h": (nusselt * fluid["k"]) / dh,
    }


def _effectiveness_ntu(ntu: float, cr: float, flow: str) -> float:
    if flow == "counter":
        if abs(cr - 1) < 1e-6:
            return ntu / (1 + ntu)
        return (1 - math.exp(-ntu * (1 - cr))) / (1 - cr * math.exp(-ntu * (1 - cr)))
    if flow == "parallel":
        return (1 - math.exp(-ntu * (1 + cr))) / (1 + cr)
    return 1 - math.exp((1 / cr) * ntu ** 0.22 * (math.exp(-cr * ntu ** 0.78) - 1))


def compute_performance(
    cell: tuple[float, float, float],
    cells: tuple[int, int, int],
    thickness: float,
    solid_fraction: float,
    specific_area: float,
    hot: dict,
    cold: dict,
    solid: dict,
    flow: str,
    nu_correction: dict | None = None,
) -> dict:
    if nu_correction is None:
        nu_correction = {
            "A": 0.089,
            "b": 0.50,
            "sourceNote": "default",
        }

    lx = (cell[0] * cells[0]) / 1000
    ly = (cell[1] * cells[1]) / 1000
    lz = (cell[2] * cells[2]) / 1000
    volume = lx * ly * lz

    solid_fraction = max(0.02, solid_fraction or 0.18)
    channel_fraction = (1 - solid_fraction) / 2

    wall_area = max(1e-6, ((specific_area or 600) * volume) / 2)
    fluid_volume = channel_fraction * volume
    dh = max(1e-4, (4 * fluid_volume) / wall_area)
    cross_area = lx * ly * channel_fraction
    path_length = lz * TORTUOSITY

    hot_perf = _side(hot, dh, cross_area, path_length, nu_correction)
    cold_perf = _side(cold, dh, cross_area, path_length, nu_correction)

    t = thickness / 1000
    ua = 1 / (
        1 / (hot_perf["h"] * wall_area) + t / (solid["k"] * wall_area) + 1 / (cold_perf["h"] * wall_area)
    )

    c_hot = hot["mdot"] * hot["cp"]
    c_cold = cold["mdot"] * cold["cp"]
    c_min = min(c_hot, c_cold)
    c_ratio = c_min / max(c_hot, c_cold)
    ntu = ua / c_min
    effectiveness = _effectiveness_ntu(ntu, c_ratio, flow)
    q = effectiveness * c_min * (hot["Tin"] - cold["Tin"])

    return {
        "hydraulicDiameter": dh,
        "wallArea": wall_area,
        "crossArea": cross_area,
        "volume": volume,
        "solidFraction": solid_fraction,
        "channelFraction": channel_fraction,
        "hot": hot_perf,
        "cold": cold_perf,
        "laminar": hot_perf["laminar"] and cold_perf["laminar"],
        "UA": ua,
        "U": ua / wall_area,
        "NTU": ntu,
        "effectiveness": effectiveness,
        "Q": q,
        "Qhot": q,
        "Qcold": q * (1 - ENERGY_IMBALANCE),
        "imbalance": ENERGY_IMBALANCE * 100,
        "cHot": c_hot,
        "cCold": c_cold,
        "cMin": c_min,
        "cRatio": c_ratio,
        "dTHot": q / c_hot,
        "dTCold": q / c_cold,
        "ThOut": hot["Tin"] - q / c_hot,
        "TcOut": cold["Tin"] + q / c_cold,
        "lengthZ": lz,
    }


def compute_scale_up(perf: dict, core: dict, cell: tuple[float, float, float], thickness: float, hot: dict, cold: dict, solid: dict, flow: str, nu_correction: dict | None = None) -> dict:
    """Port of src/lib/physics.ts computeScaleUp — extrapolates the single
    simulated unit cell to a full parallel x series core sized to the given
    target dimensions and total flow rates. Recomputed server-side from the
    same inputs (not trusted verbatim from the client), same integrity
    reasoning as compute_performance above."""
    if nu_correction is None:
        nu_correction = {
            "A": 0.089,
            "b": 0.50,
            "sourceNote": "default",
        }

    parallel_x = max(1, round(core["width"] / cell[0]))
    parallel_y = max(1, round(core["height"] / cell[1]))
    parallel = parallel_x * parallel_y
    series = max(1, round(core["length"] / cell[2]))

    mdot_hot = core["mdotHot"] / parallel
    mdot_cold = core["mdotCold"] / parallel
    path_length = perf["lengthZ"] * TORTUOSITY

    hot_perf = _side({**hot, "mdot": mdot_hot}, perf["hydraulicDiameter"], perf["crossArea"], path_length, nu_correction)
    cold_perf = _side({**cold, "mdot": mdot_cold}, perf["hydraulicDiameter"], perf["crossArea"], path_length, nu_correction)

    t = thickness / 1000
    ua_cell = 1 / (
        1 / (hot_perf["h"] * perf["wallArea"])
        + t / (solid["k"] * perf["wallArea"])
        + 1 / (cold_perf["h"] * perf["wallArea"])
    )
    ua = ua_cell * parallel * series

    c_hot = core["mdotHot"] * hot["cp"]
    c_cold = core["mdotCold"] * cold["cp"]
    c_min = min(c_hot, c_cold)
    c_ratio = c_min / max(c_hot, c_cold)
    ntu = ua / c_min
    effectiveness = _effectiveness_ntu(ntu, c_ratio, flow)
    q = effectiveness * c_min * (hot["Tin"] - cold["Tin"])

    area = perf["wallArea"] * parallel * series
    core_volume = (core["width"] * core["height"] * core["length"]) / 1e9
    pressure_drop_hot = hot_perf["pressureDrop"] * series
    pressure_drop_cold = cold_perf["pressureDrop"] * series

    return {
        "parallelX": parallel_x,
        "parallelY": parallel_y,
        "parallel": parallel,
        "series": series,
        "totalCells": parallel * series,
        "area": area,
        "coreVolume": core_volume,
        "pressureDropHot": pressure_drop_hot,
        "pressureDropCold": pressure_drop_cold,
        "UA": ua,
        "U": ua / area,
        "NTU": ntu,
        "effectiveness": effectiveness,
        "Q": q,
        "ThOut": hot["Tin"] - q / c_hot,
        "TcOut": cold["Tin"] + q / c_cold,
        "pumpingPower": (pressure_drop_hot * core["mdotHot"]) / hot["rho"],
        "powerDensity": q / 1000 / (core_volume * 1000) if core_volume > 0 else 0.0,
    }
