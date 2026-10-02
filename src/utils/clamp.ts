/** Restrict `value` to the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation between `a` and `b`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Round to the nearest multiple of `step` (used to keep zoom steps tidy). */
export function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}
