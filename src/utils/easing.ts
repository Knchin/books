import type { EasingFunction } from './animate';

export const linear: EasingFunction = (t) => t;

/** Standard ease-in-out; close to how a hand accelerates then releases a page. */
export const easeInOutQuad: EasingFunction = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export const easeOutCubic: EasingFunction = (t) => 1 - Math.pow(1 - t, 3);

export const easeInCubic: EasingFunction = (t) => t * t * t;

/**
 * Paper easing. A sheet is lifted slowly (ease-in), released, then falls under
 * gravity and settles with a small, damped bounce - the overshoot is what sells
 * "flexible material" rather than "animated div".
 */
export const paperSettle: EasingFunction = (t) => {
  const base = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  // Only the tail of the curve overshoots, and only by ~4%.
  const overshoot = t > 0.72 ? Math.sin(((t - 0.72) / 0.28) * Math.PI) * 0.04 * (1 - t) : 0;
  return base + overshoot;
};

/** Used when the user asked for reduced motion: a very short cross-fade. */
export const easeReducedMotion: EasingFunction = (t) => t * t * (3 - 2 * t);
