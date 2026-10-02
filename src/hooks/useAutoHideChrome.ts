import { useCallback, useEffect, useRef, useState } from 'react';

/** Idle time before the chrome fades out, in milliseconds. */
const HIDE_DELAY_MS = 2400;

export interface UseAutoHideChromeOptions {
  enabled: boolean;
  /** The chrome must stay visible while any of these is true. */
  pinned: boolean;
}

export interface AutoHideChrome {
  visible: boolean;
  /** Call on pointer move, touch, wheel or key press to bring the chrome back. */
  wake: () => void;
  /** Force it visible, e.g. while a menu is open. */
  pin: () => void;
  unpin: () => void;
}

/**
 * Fade the toolbar away while the reader is reading.
 *
 * It wakes on any pointer, wheel, touch or key activity. It never hides while
 * `pinned` is true, so the settings menu cannot vanish out from under the
 * pointer, and it never hides at all when the user turned the behaviour off.
 */
export function useAutoHideChrome({ enabled, pinned }: UseAutoHideChromeOptions): AutoHideChrome {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const visibleRef = useRef(true);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    clear();
    timerRef.current = setTimeout(() => {
      if (pinnedRef.current) {
        schedule();
        return;
      }
      visibleRef.current = false;
      setVisible(false);
    }, HIDE_DELAY_MS);
  }, [clear]);

  const wake = useCallback(() => {
    if (!enabled) {
      visibleRef.current = true;
      setVisible(true);
      return;
    }
    if (!visibleRef.current) {
      visibleRef.current = true;
      setVisible(true);
    }
    schedule();
  }, [enabled, schedule]);

  useEffect(() => {
    if (!enabled) {
      clear();
      visibleRef.current = true;
      setVisible(true);
      return undefined;
    }
    schedule();
    return clear;
  }, [clear, enabled, schedule]);

  // Re-arm the timer whenever the chrome becomes pinned, and hide promptly once
  // it is released and the reader has been idle.
  useEffect(() => {
    if (!enabled) return undefined;
    if (pinned) {
      wake();
      return undefined;
    }
    schedule();
    return undefined;
  }, [enabled, pinned, schedule, wake]);

  // Read by the window listener below, which must not re-subscribe every time
  // `wake` changes identity.
  const wakeRef = useRef<() => void>(() => undefined);
  wakeRef.current = wake;

  /**
   * Wake on any activity anywhere in the window.
   *
   * Bound at the window rather than on the book so a pointer merely passing over
   * the chrome brings it back - that is the whole contract of an auto-hiding
   * toolbar. `pointermove` fires at display rate, so the handler is coalesced
   * into one call per frame: `wake` is idempotent and the only cost it has when
   * already visible is re-arming a timer.
   */
  useEffect(() => {
    if (!enabled) return undefined;

    let frame = 0;
    const onActivity = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        wakeRef.current();
      });
    };

    const events = ['pointermove', 'pointerdown', 'wheel', 'touchstart', 'keydown'] as const;
    for (const name of events) {
      window.addEventListener(name, onActivity, { passive: true });
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      for (const name of events) {
        window.removeEventListener(name, onActivity);
      }
    };
  }, [enabled]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { visible, wake, pin: wake, unpin: wake };
}