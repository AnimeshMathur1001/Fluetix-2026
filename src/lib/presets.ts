import type { FaceRole, SolidMaterial, SurfaceType } from './types';

export interface FluidPreset {
  label: string;
  rho: number;
  mu: number;
  cp: number;
  k: number;
  refTempC: number;
}

export const FLUIDS: Record<string, FluidPreset> = {
  water: { label: 'Water', rho: 988, mu: 5.5e-4, cp: 4181, k: 0.644, refTempC: 50 },
  air: { label: 'Air @ 1 atm', rho: 1.093, mu: 1.96e-5, cp: 1007, k: 0.0281, refTempC: 50 },
  hydrogen: { label: 'Hydrogen gas @ 1 atm', rho: 0.0746, mu: 9.3e-6, cp: 14400, k: 0.196, refTempC: 25 },
  eg50: { label: 'Ethylene glycol / water 50 %', rho: 1070, mu: 3.5e-3, cp: 3300, k: 0.39, refTempC: 40 },
  oil: { label: 'Mineral oil ISO VG32', rho: 860, mu: 2.4e-2, cp: 1900, k: 0.13, refTempC: 60 },
  custom: { label: 'Custom (manual override)', rho: 0, mu: 0, cp: 0, k: 0, refTempC: 25 },
};

export const SOLIDS: Record<string, SolidMaterial & { label: string }> = {
  alsi10mg: { mat: 'alsi10mg', label: 'AlSi10Mg (LPBF)', k: 130, rho: 2670, cp: 910 },
  ti64: { mat: 'ti64', label: 'Ti-6Al-4V', k: 6.7, rho: 4430, cp: 560 },
  ss316: { mat: 'ss316', label: '316L stainless', k: 15, rho: 8000, cp: 500 },
  cucrzr: { mat: 'cucrzr', label: 'CuCrZr', k: 320, rho: 8900, cp: 390 },
  in718: { mat: 'in718', label: 'Inconel 718', k: 11.4, rho: 8190, cp: 435 },
};

export const SURFACES: { key: SurfaceType; label: string; equation: string }[] = [
  { key: 'gyroid', label: 'Gyroid', equation: 'sin x cos y + …' },
  { key: 'schwarzp', label: 'Schwarz-P', equation: 'cos x + cos y + cos z' },
  { key: 'diamond', label: 'Diamond', equation: 'sin·sin·sin + …' },
  { key: 'iwp', label: 'IWP', equation: '2(cos x cos y + …)' },
];

export const FACE_ROLES: { value: FaceRole; label: string }[] = [
  { value: 'periodicA', label: 'Periodic – pair A' },
  { value: 'periodicB', label: 'Periodic – pair B' },
  { value: 'inletHot', label: 'Inlet – hot' },
  { value: 'outletHot', label: 'Outlet – hot' },
  { value: 'inletCold', label: 'Inlet – cold' },
  { value: 'outletCold', label: 'Outlet – cold' },
  { value: 'wall', label: 'Wall' },
];

export const WORKFLOW_STEPS = [
  'Geometry',
  'Regions',
  'Case',
  'Mesh & Solve',
  'Results',
  'Scale-up',
  'Explore',
] as const;
