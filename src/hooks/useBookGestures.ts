import { useCallback, useEffect, useRef } from 'react';
import { clamp } from '../utils/clamp';

export interface GestureConfig {
  /** Pointer travel in px before a press counts as a drag rather than a tap. */
  dragSlop: number;
  /** Travel in px before a press counts as a pinch rather than a drag. */
  pinchSlop: number;
  /** Distance in px between taps that counts as a double tap. */
  doubleTapSlop: number;
  /** Maximum ms between the taps of a double tap. */
  doubleTapMs: number;
}

export const DEFAULT_GESTURES: GestureConfig = {
  dragSlop: 6,
  pinchSlop: 18,
  doubleTapSlop: 32,
  doubleTapMs: 320,
};

export interface GestureCallbacks {
  /**
   * Coordinates are always *client* space, so the flip engine's drag origin and
   * its per-frame updates share one coordinate system.
   *
   * @param side which page the press landed on
   */
  onDragStart: (
    side: 'left' | 'right',
    clientX: number,
    clientY: number,
    pageWidth: number,
  ) => boolean;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: () => void;
  /**
   * A press that never became a drag.
   * @param inEdgeZone true when the press landed in the outer 18% of the page,
   *        which is the only place a tap turns the page while zoomed in.
   */
  onTap: (side: 'left' | 'right', inEdgeZone: boolean) => void;
  /** Two-finger pinch. `scale` is relative to the start of the gesture. */
  onPinch: (scale: number) => void;
  onPinchEnd: () => void;
  onDoubleTap: () => void;
}

/** Outer fraction of a page that always acts as a page-turn strip. */
export const EDGE_ZONE = 0.18;

type Mode = 'idle' | 'undecided' | 'drag' | 'pinch';

interface TrackedPointer {
  id: number;
  x: number;
  y: number;
}

/**
 * All pointer interaction for the book surface.
 *
 * One hook owns every gesture so they cannot fight each other: a second finger
 * promotes an in-flight drag to a pinch, a mostly-vertical drag is handed back to
 * the browser for scrolling, and only one mode is ever live at a time.
 *
 * Touch and mouse share one path on purpose. A horizontal swipe on a phone *is* a
 * page drag, and because the commit test includes velocity, a short fast flick
 * turns the page even when it never covered the 30% threshold - which is what
 * makes swiping feel like a book rather than a slider.
 */
export function useBookGestures(
  element: HTMLElement | null,
  callbacks: GestureCallbacks,
  config: GestureConfig = DEFAULT_GESTURES,
): void {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const configRef = useRef(config);
  configRef.current = config;

  const pointersRef = useRef(new Map<number, TrackedPointer>());
  const modeRef = useRef<Mode>('idle');
  const startRef = useRef({ x: 0, y: 0 });
  const sideRef = useRef<'left' | 'right'>('right');
  const lastTapRef = useRef({ x: 0, y: 0, time: 0 });
  const pinchDistanceRef = useRef(0);

  const release = useCallback(() => {
    if (modeRef.current === 'drag') callbacksRef.current.onDragEnd();
    pointersRef.current.clear();
    modeRef.current = 'idle';
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      const host = element;
      if (!host) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      // Never hijack a press that began on real interface chrome.
      const target = event.target;
      if (target instanceof Element && target.closest('[data-no-gesture]')) return;

      pointersRef.current.set(event.pointerId, {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      });

      if (pointersRef.current.size === 2) {
        // A second finger promotes whatever was happening to a pinch. A pinch
        // must never be able to become a page turn.
        if (modeRef.current === 'drag') callbacksRef.current.onDragEnd();
        const [a, b] = Array.from(pointersRef.current.values());
        pinchDistanceRef.current = Math.hypot(a.x - b.x, a.y - b.y);
        modeRef.current = 'pinch';
        return;
      }
      if (pointersRef.current.size > 2) return;

      const rect = host.getBoundingClientRect();
      startRef.current = { x: event.clientX, y: event.clientY };
      sideRef.current = event.clientX - rect.left < rect.width / 2 ? 'left' : 'right';

      const now = performance.now();
      const last = lastTapRef.current;
      if (
        now - last.time < configRef.current.doubleTapMs &&
        Math.hypot(event.clientX - last.x, event.clientY - last.y) <
          configRef.current.doubleTapSlop
      ) {
        lastTapRef.current = { x: 0, y: 0, time: 0 };
        pointersRef.current.clear();
        modeRef.current = 'idle';
        callbacksRef.current.onDoubleTap();
        return;
      }

      modeRef.current = 'undecided';
    },
    [element],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const host = element;
      const mode = modeRef.current;
      if (!host || mode === 'idle') return;

      const tracked = pointersRef.current.get(event.pointerId);
      if (!tracked) return;
      tracked.x = event.clientX;
      tracked.y = event.clientY;

      if (mode === 'pinch') {
        if (pointersRef.current.size < 2) return;
        const [a, b] = Array.from(pointersRef.current.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistanceRef.current > 0) {
          callbacksRef.current.onPinch(clamp(distance / pinchDistanceRef.current, 0.2, 5));
        }
        return;
      }

      const dx = event.clientX - startRef.current.x;
      const dy = event.clientY - startRef.current.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      if (mode === 'undecided') {
        const { dragSlop, pinchSlop } = configRef.current;
        if (absY > pinchSlop && absY > absX) {
          // Clearly vertical: this is a scroll. Give it straight back.
          modeRef.current = 'idle';
          return;
        }
        if (absX >= dragSlop) {
          const rect = host.getBoundingClientRect();
          const pageWidth = Math.max(1, rect.width / 2);
          const started = callbacksRef.current.onDragStart(
            sideRef.current,
            startRef.current.x,
            startRef.current.y,
            pageWidth,
          );
          modeRef.current = started ? 'drag' : 'idle';
          if (!started) return;
          // The page is already at progress 0; feed it the movement that
          // triggered the decision so it starts under the finger.
          callbacksRef.current.onDragMove(event.clientX, event.clientY);
        }
        return;
      }

      callbacksRef.current.onDragMove(event.clientX, event.clientY);
    },
    [element],
  );

  const finishPointer = useCallback(
    (event: PointerEvent, cancelled: boolean) => {
      const tracked = pointersRef.current.delete(event.pointerId);
      if (!tracked) return;

      const mode = modeRef.current;

      if (mode === 'pinch') {
        if (pointersRef.current.size < 2) {
          callbacksRef.current.onPinchEnd();
          // Lifting one finger of a pinch must not turn into a drag.
          modeRef.current = 'idle';
        }
        return;
      }

      if (mode === 'drag') {
        modeRef.current = 'idle';
        callbacksRef.current.onDragEnd();
        return;
      }

      if (mode !== 'undecided' || cancelled) {
        modeRef.current = 'idle';
        return;
      }

      modeRef.current = 'idle';
      const host = element;
      if (!host) return;

      const moved = Math.hypot(
        event.clientX - startRef.current.x,
        event.clientY - startRef.current.y,
      );
      if (moved > 4) return;

      lastTapRef.current = { x: event.clientX, y: event.clientY, time: performance.now() };
      const rect = host.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const withinPage = sideRef.current === 'right' ? localX - rect.width / 2 : localX;
      const inEdgeZone = withinPage <= rect.width / 2 * EDGE_ZONE;
      callbacksRef.current.onTap(sideRef.current, inEdgeZone);
    },
    [element],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => finishPointer(event, false),
    [finishPointer],
  );

  const onPointerCancel = useCallback(
    (event: PointerEvent) => finishPointer(event, true),
    [finishPointer],
  );

  const onContextMenu = useCallback((event: MouseEvent) => {
    if (modeRef.current === 'drag') event.preventDefault();
  }, []);

  // `touch-action: pan-y` already keeps horizontal movement out of the
  // browser's hands, but Safari will still scroll a long horizontal drag, so a
  // non-passive listener is needed to suppress it while we own the gesture.
  const onTouchMove = useCallback((event: TouchEvent) => {
    const mode = modeRef.current;
    if ((mode === 'drag' || mode === 'pinch') && event.cancelable) event.preventDefault();
  }, []);

  useEffect(() => {
    if (!element) return undefined;

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerCancel);
    element.addEventListener('lostpointercapture', onPointerCancel);
    element.addEventListener('contextmenu', onContextMenu);
    element.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
      element.removeEventListener('lostpointercapture', onPointerCancel);
      element.removeEventListener('contextmenu', onContextMenu);
      element.removeEventListener('touchmove', onTouchMove);
    };
  }, [
    element,
    onContextMenu,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onTouchMove,
  ]);

  useEffect(() => {
    // A pointer released outside the book, or a window blur mid-drag, would
    // otherwise leave the page stuck half turned.
    window.addEventListener('blur', release);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('blur', release);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [release]);
}