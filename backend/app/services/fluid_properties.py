"""GET /properties and GET /fluids backing service. Real CoolProp (equation of
state / incompressible-mixture correlations) for every fluid CoolProp ships —
136 pure/pseudo-pure EOS fluids plus the ethylene-glycol/water secondary
coolant via CoolProp's INCOMP backend — genuinely temperature *and* pressure
dependent throughout. Only "oil" (generic mineral oil has no published EOS
in CoolProp) still falls back to a disclosed hand-fit correlation; behaviour
matches src/lib/fluidProperties.ts's fallback exactly so the two never
disagree when the backend is unreachable.
"""
from __future__ import annotations

import math
import re

try:
    from CoolProp.CoolProp import PropsSI as _PropsSI
    from CoolProp.CoolProp import get_global_param_string as _get_global_param_string

    HAVE_COOLPROP = True
except ImportError:
    _PropsSI = None
    _get_global_param_string = None
    HAVE_COOLPROP = False

# Legacy lowercase keys (pre-dating the full CoolProp list) still resolve to
# their real CoolProp name — old autosaves/.hxproj.json files keep working.
_LEGACY_ALIASES = {"water": "Water", "air": "Air", "hydrogen": "Hydrogen"}

# Not real CoolProp fluid names — routed to INCOMP or a hand correlation below.
_SPECIAL_FLUIDS = {
    "eg50": {"label": "Ethylene glycol / water 50 %", "coolprop": "INCOMP::MEG-50%"},
    "oil": {"label": "Mineral oil ISO VG32", "coolprop": None},
}

_CAMEL_RE = re.compile(r"([a-z0-9])([A-Z])")


def _prettify(name: str) -> str:
    return _CAMEL_RE.sub(r"\1 \2", name)


def _resolve(fluid: str) -> str:
    return _LEGACY_ALIASES.get(fluid, fluid)


def list_fluids() -> list[dict]:
    """Every fluid the /properties endpoint can genuinely evaluate — the full
    CoolProp pure/pseudo-pure list (real T&P equation of state) plus the
    ethylene-glycol blend (real CoolProp INCOMP mixture) and the one
    disclosed correlation fallback."""
    out: list[dict] = []
    if HAVE_COOLPROP and _get_global_param_string:
        for name in _get_global_param_string("FluidsList").split(","):
            if not name:
                continue
            out.append({"key": name, "label": _prettify(name), "source": "coolprop"})
    out.append({"key": "eg50", "label": _SPECIAL_FLUIDS["eg50"]["label"], "source": "coolprop" if HAVE_COOLPROP else "correlation"})
    out.append({"key": "oil", "label": _SPECIAL_FLUIDS["oil"]["label"], "source": "correlation"})
    out.sort(key=lambda f: f["label"])
    return out


_CORRELATION_RANGES = {
    "Water": (0, 150),
    "Air": (-20, 400),
    "Hydrogen": (-20, 400),
    "eg50": (0, 110),
    "oil": (0, 150),
}


def _correlation(fluid: str, t: float) -> dict | None:
    """Hand-fit fallback — used only when CoolProp is unavailable, or a state
    point falls outside CoolProp's valid range for that fluid. Kept for the
    handful of fluids the front end already ships instant client-side
    correlations for (see src/lib/fluidProperties.ts); anything else in the
    full 136-fluid list simply has no fallback and 404s if CoolProp itself
    isn't installed."""
    if fluid == "Water":
        return {
            "rho": 999.8 - 0.054 * t - 0.00364 * t * t,
            "mu": 2.414e-5 * 10 ** (247.8 / (t + 273.15 - 140)),
            "cp": 4217.4 - 3.720283 * t + 0.1412855 * t * t - 2.654387e-3 * t ** 3 + 2.093236e-5 * t ** 4,
            "k": 0.561 + 0.00214 * t - 9.6e-6 * t * t,
        }
    if fluid == "Air":
        tk = t + 273.15
        mu0, t0, c = 1.716e-5, 273.15, 110.4
        return {
            "rho": 101325 / (287.05 * tk),
            "mu": mu0 * ((t0 + c) / (tk + c)) * (tk / t0) ** 1.5,
            "cp": 1006 + 0.0605 * t,
            "k": 0.0241 + 7.1e-5 * t,
        }
    if fluid == "Hydrogen":
        tk = t + 273.15
        mu_ref, t_ref, c = 8.76e-6, 293.85, 72
        return {
            "rho": 101325 / (4124.2 * tk),
            "mu": mu_ref * ((t_ref + c) / (tk + c)) * (tk / t_ref) ** 1.5,
            "cp": 14300 + 0.5 * t,
            "k": 0.182 + 0.00045 * t,
        }
    if fluid == "eg50":
        return {
            "rho": 1087 - 0.62 * t,
            "mu": 3.5e-3 * math.exp(-0.03 * (t - 40)),
            "cp": 3300 + 1.8 * (t - 40),
            "k": 0.39 + 0.0008 * (t - 40),
        }
    if fluid == "oil":
        return {
            "rho": 860 - 0.6 * (t - 60),
            "mu": 0.024 * math.exp(-0.035 * (t - 60)),
            "cp": 1900 + 3.2 * (t - 60),
            "k": 0.13 - 0.00012 * (t - 60),
        }
    return None


def evaluate_fluid(fluid: str, temp_c: float, pressure_pa: float = 101325.0) -> dict | None:
    """Returns {rho, mu, cp, k, source} for any fluid in list_fluids(), genuinely
    evaluated at the given temperature AND pressure (not just T) whenever CoolProp
    is doing the work — or None for an unrecognised key."""
    fluid = _resolve(fluid)
    special = _SPECIAL_FLUIDS.get(fluid)
    coolprop_name = special["coolprop"] if special else fluid

    if HAVE_COOLPROP and coolprop_name:
        tk = temp_c + 273.15
        try:
            return {
                "rho": _PropsSI("D", "T", tk, "P", pressure_pa, coolprop_name),
                "mu": _PropsSI("V", "T", tk, "P", pressure_pa, coolprop_name),
                "cp": _PropsSI("C", "T", tk, "P", pressure_pa, coolprop_name),
                "k": _PropsSI("L", "T", tk, "P", pressure_pa, coolprop_name),
                "source": "coolprop",
            }
        except ValueError:
            pass  # out of CoolProp's valid range for this state point — fall through

    if fluid not in _CORRELATION_RANGES:
        return None  # no hand-fit fallback for this one — genuinely unavailable offline
    lo, hi = _CORRELATION_RANGES[fluid]
    t = max(lo, min(hi, temp_c))
    state = _correlation(fluid, t)
    if state is None:
        return None
    state["source"] = "correlation"
    return state
