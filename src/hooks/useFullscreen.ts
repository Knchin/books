import { useCallback, useEffect, useRef, useState } from 'react';
import { focusSilently } from '../utils/dom';

export interface FullscreenControls {
  isFullscreen: boolean;
  isSupported: boolean;
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  toggle: () => Promise<void>;
}

/**
 * Fullscreen via the standard API.
 *
 * Everything degrades gracefully: Safari on iPhone does not implement
 * Fullscreen on arbitrary elements, so `isSupported` is false there and the
 * toolbar simply does not offer the button. The reader stays fully usable in a
 * normal tab.
 */
export function useFullscreen(target: HTMLElement | null): FullscreenControls {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const targetRef = useRef<HTMLElement | null>(null);
  targetRef.current = target;

  const isSupported =
    typeof document !== 'undefined' &&
    typeof document.documentElement.requestFullscreen === 'function';

  useEffect(() => {
    if (!isSupported) return;

    const sync = () => setIsFullscreen(document.fullscreenElement === targetRef.current);

    document.addEventListener('fullscreenchange', sync);
    // Re-sync on mount: the reader can mount *while* already fullscreen (for
    // example when a component remounts inside an existing fullscreen session).
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [isSupported]);

  const enter = useCallback(async () => {
    const element = targetRef.current;
    if (!element || !isSupported) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await element.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      // Denied (iOS Safari, permissions policy, a user gesture requirement).
      // The reader keeps working; nothing to report to the user.
    }
  }, [isSupported]);

  const exit = useCallback(async () => {
    if (!isSupported || !document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  }, [isSupported]);

  const toggle = useCallback(async () => {
    if (document.fullscreenElement) await exit();
    else await enter();
  }, [enter, exit]);

  return { isFullscreen, isSupported, enter, exit, toggle };
}

/** Move focus without yanking the scroll position around. */
export { focusSilently };