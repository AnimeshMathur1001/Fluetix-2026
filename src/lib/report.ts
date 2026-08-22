import type { Performance, ScaleUpResult } from './physics';
import type { AppState } from '../store/useAppStore';

export interface Report {
  case: string;
  generated: string;
  app: string;
  geometry: Record<string, unknown>;
  mesh: unknown;
  turbulence: string;
  flow_arrangement: string;
  boundary_conditions: Record<string, unknown>;
  convergence: Record<string, unknown>;
  results_unit_cell: Record<string, number>;
  scale_up: Record<string, unknown>;
}

/** Assembles the exportable report: case setup, mesh stats, convergence and all metrics. */
export function buildReport(
  s: AppState,
  perf: Performance,
  scale: ScaleUpResult,
  turbulence: string,
): Report {
  return {
    case: s.caseName,
    generated: new Date().toISOString(),
    app: 'Fluetix 0.7.0',
    geometry: {
      surface: s.surface,
      cell_mm: [s.cellX, s.cellY, s.cellZ],
      wall_thickness_mm: s.thickness,
      grading: s.grading,
      grading_axis: s.gradAxis,
      cells: [s.nx, s.ny, s.nz],
      mode: s.mode,
      solid_fraction: Number(s.stats.solidFraction.toFixed(4)),
      specific_area_m2_per_m3: Number(s.stats.specificArea.toFixed(1)),
      watertight: Boolean(s.watertight?.ok),
    },
    mesh: s.mesh,
    turbulence,
    flow_arrangement: s.flow,
    boundary_conditions: { hot: s.hot, cold: s.cold, solid: s.solid, faces: s.faces },
    convergence: {
      status: s.converged === true ? 'converged' : s.converged === false ? 'NOT CONVERGED' : 'not run',
      iterations: s.iteration,
      target: s.residualTarget,
    },
    results_unit_cell: {
      dp_hot_Pa: Number(perf.hot.pressureDrop.toFixed(2)),
      dp_cold_Pa: Number(perf.cold.pressureDrop.toFixed(2)),
      Q_W: Number(perf.Q.toFixed(3)),
      U_W_m2K: Number(perf.U.toFixed(1)),
      UA_W_K: Number(perf.UA.toFixed(4)),
      NTU: Number(perf.NTU.toFixed(4)),
      effectiveness: Number(perf.effectiveness.toFixed(4)),
      Re_hot: Number(perf.hot.reynolds.toFixed(0)),
      Re_cold: Number(perf.cold.reynolds.toFixed(0)),
      Dh_mm: Number((perf.hydraulicDiameter * 1000).toFixed(3)),
      energy_balance_error_pct: Number(perf.imbalance.toFixed(2)),
    },
    scale_up: {
      core_mm: [s.core.width, s.core.height, s.core.length],
      cells: scale.totalCells,
      parallel: scale.parallel,
      series: scale.series,
      dp_hot_kPa: Number((scale.pressureDropHot / 1000).toFixed(2)),
      Q_kW: Number((scale.Q / 1000).toFixed(3)),
      U_W_m2K: Number(scale.U.toFixed(1)),
      NTU: Number(scale.NTU.toFixed(3)),
      effectiveness: Number(scale.effectiveness.toFixed(4)),
      area_m2: Number(scale.area.toFixed(3)),
      assumption:
        'periodic repetition of the simulated unit cell; entrance, manifold and header effects excluded',
    },
  };
}
