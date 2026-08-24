import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware class name joiner (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatNumber(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e5 || (a < 1e-3 && a > 0)) return v.toExponential(2);
  return v.toFixed(digits);
}

export type TempUnit = 'C' | 'K';

/** Everything is stored/computed in Celsius internally — these only convert
 *  for display/edit. ΔT is identical in °C and K, so callers that just need
 *  a step size or a delta (e.g. inlet-outlet difference) don't need either
 *  of these at all, only absolute temperatures do. */
export function toDisplayTemp(celsius: number, unit: TempUnit): number {
  return unit === 'K' ? celsius + 273.15 : celsius;
}

export function fromDisplayTemp(value: number, unit: TempUnit): number {
  return unit === 'K' ? value - 273.15 : value;
}

export function tempUnitLabel(unit: TempUnit): string {
  return unit === 'K' ? 'K' : '°C';
}

export function formatInt(v: number): string {
  return Math.round(v).toLocaleString('en-GB');
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function timestamp(): string {
  return new Date().toLocaleTimeString('en-GB');
}
