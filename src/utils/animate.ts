/** A cancellable requestAnimationFrame tween driven by an easing curve. */
export type EasingFunction = (t: number) => number;

export interface AnimationHandle {
  /** Jump to the end value and fire the completion callback once. */
  finish(): void;
  /** Stop where it is; `onUpdate` is *not* called with the final value. */
  cancel(): void;
  readonly finished: boolean;
}

export interface AnimateOptions {
  durationMs: number;
  easing: EasingFunction;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
  /**
   * Injected frame source, for deterministic stepping in tests.
   * Defaults to `window.requestAnimationFrame`.
   */
  raf?: (cb: (time: number) => void) => number;
}

/**
 * Minimal tween engine.
 *
 * Deliberately allocation-free per frame: no React state, no layout reads, one
 * style write per value. This is what keeps the flip at 60fps even while PDF.js
 * is rasterising pages in the worker.
 */
export function animateValue(
  from: number,
  to: number,
  options: AnimateOptions,
): AnimationHandle {
  const raf =
    options.raf ??
    ((cb: (time: number) => void) => window.requestAnimationFrame(cb));
  let rafId = 0;
  let startTime: number | null = null;
  let done = false;

  const step = (time: number) => {
    if (done) return;
    if (startTime === null) startTime = time;
    const elapsed = time - startTime;
    const t = options.durationMs <= 0 ? 1 : Math.min(1, elapsed / options.durationMs);
    options.onUpdate(from + (to - from) * options.easing(t));
    if (t < 1) {
      rafId = raf(step);
    } else {
      done = true;
      options.onComplete?.();
    }
  };

  rafId = raf(step);

  return {
    get finished() {
      return done;
    },
    finish() {
      if (done) return;
      done = true;
      if (rafId) window.cancelAnimationFrame?.(rafId);
      options.onUpdate(to);
      options.onComplete?.();
    },
    cancel() {
      if (done) return;
      done = true;
      if (rafId) window.cancelAnimationFrame?.(rafId);
    },
  };
}