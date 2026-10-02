import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clamp } from '../utils/clamp';
import { animateValue, type AnimationHandle } from '../utils/animate';
import { paperSettle } from '../utils/easing';
import type { FrameKind, FlipSnapshot } from '../types/book';

export interface UseFlipEngineOptions {
  spreadCount: number;
  reducedMotion: boolean;
  onIndexChange: (index: number) => void;
  /** Called when a turn starts, so the pages it needs can be prioritised. */
  onTurnRequested: (fromIndex: number, toIndex: number) => void;
}

/** Fraction of a page that must be dragged past for the turn to commit. */
const COMMIT_THRESHOLD = 0.3;
/** Drag velocity (page widths per second) that commits regardless of distance. */
const FLICK_VELOCITY = 0.55;
/** How long the spring-back to the starting position takes. */
const SPRING_MS = 260;
/** Longest a single turn may take, however far it travels. */
const MAX_TURN_MS = 780;

export type DragSide = 'left' | 'right';

export interface DragState {
  side: DragSide;
  originX: number;
  pageWidth: number;
}

export type ProgressListener = (progress: number, snapshot: FlipSnapshot) => void;

export interface FlipEngine {
  index: number;
  snapshot: FlipSnapshot;
  atStart: boolean;
  atEnd: boolean;
  next: () => void;
  previous: () => void;
  goTo: (index: number, options?: { immediate?: boolean }) => void;
  /**
   * Adopt a rebuilt spread list.
   *
   * Changing page pairing or the view mode produces a new list with a different
   * length, so the count and the current index have to move together. Passing
   * the index on its own would clamp it against the list that no longer exists:
   * asking for spread 3 of a list that still claims to hold 2 lands on spread 2.
   */
  adoptSpreads: (spreadCount: number, index: number) => void;
  /** Begin a drag. Returns false when the gesture cannot start. */
  /**
   * @param originX client-space x where the drag began; `updateDrag` is called
   * in the same coordinate space.
   */
  beginDrag: (side: DragSide, originX: number, pageWidth: number) => boolean;
  updateDrag: (x: number) => void;
  endDrag: () => void;
  cancelDrag: () => void;
  /** Snap any in-flight animation to its destination. */
  settle: () => void;
  /**
   * Subscribe to the continuous progress channel. Listeners run inside the
   * animation frame, so they must only write styles - never set React state.
   */
  subscribeProgress: (listener: ProgressListener) => () => void;
  /** Current progress, for seeding styles before the first frame arrives. */
  getProgress: () => number;
}

function idle(index: number, direction: 1 | -1 = 1): FlipSnapshot {
  return { phase: 'idle', frame: 'idle', direction, fromIndex: index, toIndex: index, progress: 0 };
}

/**
 * The page-turn state machine.
 *
 * The load-bearing decision: continuous progress never passes through React
 * state. `progressRef` is mutated inside the rAF callback and forwarded to
 * imperative subscribers that write CSS custom properties on the book root.
 * React re-renders only when a turn's *structure* changes
 * (idle -> dragging -> animating -> idle) - a handful of times per turn instead
 * of 60 times per second.
 *
 * `progress` always means "how far the sheet has travelled from where it
 * started (0) to where it lands (1)", for opening, both turn directions and
 * closing alike. That single convention is what lets every gesture share one
 * code path; see `BookFrame.angleScale` / `angleOffset`.
 */
export function useFlipEngine(options: UseFlipEngineOptions): FlipEngine {
  const { spreadCount, reducedMotion, onIndexChange, onTurnRequested } = options;

  const [index, setIndex] = useState(0);
  const [snapshot, setSnapshot] = useState<FlipSnapshot>(() => idle(0));

  const indexRef = useRef(0);
  const snapshotRef = useRef<FlipSnapshot>(idle(0));
  const animationRef = useRef<AnimationHandle | null>(null);
  const progressRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const velocityRef = useRef(0);
  const lastMoveRef = useRef({ x: 0, time: 0 });
  const listenersRef = useRef(new Set<ProgressListener>());
  const lastSpreadCount = useRef(spreadCount);
  // Gestures and toolbar presses reach the engine long after the render that
  // created them, so the length is read from a ref rather than a closed-over
  // value that may belong to a list the reader has already left.
  const spreadCountRef = useRef(spreadCount);

  const emitProgress = useCallback((progress: number, state: FlipSnapshot) => {
    progressRef.current = progress;
    for (const listener of Array.from(listenersRef.current)) listener(progress, state);
  }, []);

  const stopAnimation = useCallback(() => {
    animationRef.current?.cancel();
    animationRef.current = null;
  }, []);

  const commitIndex = useCallback(
    (next: number) => {
      const clamped = clamp(Math.round(next), 0, Math.max(0, spreadCountRef.current - 1));
      if (clamped === indexRef.current) return;
      indexRef.current = clamped;
      setIndex(clamped);
      onIndexChange(clamped);
    },
    [onIndexChange],
  );

  const land = useCallback(
    (target: number, direction: 1 | -1) => {
      const rest = idle(target, direction);
      snapshotRef.current = rest;
      setSnapshot(rest);
      emitProgress(0, rest);
    },
    [emitProgress],
  );

  const settle = useCallback(() => {
    dragRef.current = null;
    stopAnimation();
    land(indexRef.current, snapshotRef.current.direction);
  }, [land, stopAnimation]);

  /**
   * Run a turn from `fromIndex` to `toIndex`.
   *
   * A request arriving mid-animation snaps that animation to its destination
   * first, so mashing "next" lands on the page the reader actually asked for
   * instead of queueing turns nobody wanted.
   */
  const play = useCallback(
    (
      kind: Exclude<FrameKind, 'idle'>,
      direction: 1 | -1,
      fromIndex: number,
      toIndex: number,
      fromProgress = 0,
    ) => {
      stopAnimation();
      onTurnRequested(fromIndex, toIndex);

      if (reducedMotion) {
        // Honour the preference: change the page and announce it, but skip the
        // motion entirely.
        commitIndex(toIndex);
        land(toIndex, direction);
        return;
      }

      const opening: FlipSnapshot = {
        phase: 'animating',
        frame: kind,
        direction,
        fromIndex,
        toIndex,
        progress: fromProgress,
      };
      snapshotRef.current = opening;
      setSnapshot(opening);
      emitProgress(fromProgress, opening);

      // A long jump (End key, thumbnail click) takes proportionally longer so
      // the motion never reads as a glitch - but never so long it feels stuck.
      const distance = Math.abs(toIndex - fromIndex);
      const duration =
        kind === 'turn' ? clamp(280 + distance * 170, 280, MAX_TURN_MS) : 760;

      animationRef.current = animateValue(fromProgress, 1, {
        durationMs: duration,
        easing: paperSettle,
        onUpdate: (value) => emitProgress(value, opening),
        onComplete: () => {
          animationRef.current = null;
          commitIndex(toIndex);
          land(toIndex, direction);
        },
      });
    },
    [commitIndex, emitProgress, land, onTurnRequested, reducedMotion, stopAnimation],
  );

  const next = useCallback(() => {
    const from = indexRef.current;
    const to = from + 1;
    if (to >= spreadCountRef.current) return;
    // Turning forward off the cover is a different gesture: the whole front
    // board swings open, not a single page.
    play(from === 0 ? 'open' : 'turn', 1, from, to);
  }, [play]);

  const previous = useCallback(() => {
    const from = indexRef.current;
    const to = from - 1;
    if (to < 0) return;
    // Stepping back from the first reading spread closes the book again.
    play(from === 1 ? 'close' : 'turn', -1, from, to);
  }, [play]);

  const goTo = useCallback(
    (target: number, opts?: { immediate?: boolean }) => {
      const clamped = clamp(Math.round(target), 0, Math.max(0, spreadCountRef.current - 1));
      const from = indexRef.current;
      if (clamped === from && snapshotRef.current.phase === 'idle') return;

      if (snapshotRef.current.phase !== 'idle') {
        // Land whatever is in flight before deciding, so a burst of input
        // resolves to the last thing the reader asked for.
        settle();
      }
      if (clamped === from) return;

      if (opts?.immediate) {
        commitIndex(clamped);
        land(clamped, clamped > from ? 1 : -1);
        return;
      }

      const direction: 1 | -1 = clamped > from ? 1 : -1;
      if (from === 0 && direction === 1) play('open', 1, from, clamped);
      else if (from === 1 && direction === -1 && clamped === 0) play('close', -1, from, clamped);
      else play('turn', direction, from, clamped);
    },
    [commitIndex, land, play, settle, spreadCount],
  );

  // ------------------------------------------------------------------ dragging

  const beginDrag = useCallback(
    (side: DragSide, originX: number, pageWidth: number): boolean => {
      if (pageWidth <= 0) return false;
      if (snapshotRef.current.phase === 'animating') return false;

      const from = indexRef.current;
      const direction: 1 | -1 = side === 'right' ? 1 : -1;
      const destination = from + direction;
      // Dragging past the end of the book is not a gesture; let it pan instead.
      if (destination < 0 || destination >= spreadCount) return false;
      if (snapshotRef.current.phase !== 'idle') settle();

      // Dragging the left page while sitting on the first reading spread is
      // closing the book, which is a different frame, not a page turn.
      const frame: FrameKind =
        direction === 1 ? (from === 0 ? 'open' : 'turn') : from === 1 ? 'close' : 'turn';

      dragRef.current = { side, originX, pageWidth };
      velocityRef.current = 0;
      lastMoveRef.current = { x: originX, time: performance.now() };

      const dragging: FlipSnapshot = {
        phase: 'dragging',
        frame,
        direction,
        fromIndex: from,
        toIndex: destination,
        progress: 0,
      };
      snapshotRef.current = dragging;
      setSnapshot(dragging);
      emitProgress(0, dragging);
      return true;
    },
    [emitProgress, settle, spreadCount],
  );

  const updateDrag = useCallback(
    (x: number) => {
      const drag = dragRef.current;
      if (!drag) return;

      // Forward: the finger travels left and the sheet follows. Backward and
      // closing: the finger travels right. Both grow the same 0..1 progress.
      const travelled = drag.side === 'right' ? drag.originX - x : x - drag.originX;
      const progress = clamp(travelled / drag.pageWidth, 0, 1);

      const now = performance.now();
      const dt = Math.max(1, now - lastMoveRef.current.time);
      const dx = x - lastMoveRef.current.x;
      // "Page widths per second", positive when moving away from the hinge.
      velocityRef.current = ((dx / drag.pageWidth / dt) * 1000) * (drag.side === 'right' ? -1 : 1);
      lastMoveRef.current = { x, time: now };

      emitProgress(progress, snapshotRef.current);
    },
    [emitProgress],
  );

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    const state = snapshotRef.current;
    if (state.phase !== 'dragging') return;

    const from = state.fromIndex;
    const to = state.toIndex;
    const progress = progressRef.current;

    const commit = progress >= COMMIT_THRESHOLD || velocityRef.current > FLICK_VELOCITY;

    if (commit && state.frame !== 'idle') {
      // Hand the remaining rotation to the tween, starting from wherever the
      // finger left off, so the hand-off is invisible.
      play(state.frame, state.direction, from, to, progress);
      return;
    }

    // Not far enough: spring back to where the sheet started.
    if (reducedMotion) {
      land(from, state.direction);
      return;
    }

    const springing: FlipSnapshot = { ...state, phase: 'animating' };
    snapshotRef.current = springing;
    setSnapshot(springing);
    animationRef.current = animateValue(progress, 0, {
      durationMs: SPRING_MS,
      easing: paperSettle,
      onUpdate: (value) => emitProgress(value, springing),
      onComplete: () => {
        animationRef.current = null;
        land(from, state.direction);
      },
    });
  }, [emitProgress, land, play, reducedMotion]);

  const cancelDrag = useCallback(() => {
    dragRef.current = null;
    stopAnimation();
    land(indexRef.current, snapshotRef.current.direction);
  }, [land, stopAnimation]);

  // A new document resets the reader to the cover.
  const adoptSpreads = useCallback(
    (count: number, target: number) => {
      stopAnimation();
      cancelDrag();
      const clamped = clamp(Math.round(target), 0, Math.max(0, count - 1));
      const previous = indexRef.current;
      lastSpreadCount.current = count;
      spreadCountRef.current = count;
      indexRef.current = clamped;
      setIndex(clamped);
      // No turn to animate: the page on screen is simply a different page now.
      land(clamped, clamped > previous ? 1 : -1);
      onIndexChange(clamped);
    },
    [cancelDrag, land, onIndexChange, stopAnimation],
  );

  useEffect(() => {
    if (lastSpreadCount.current === spreadCount) return;
    lastSpreadCount.current = spreadCount;
    spreadCountRef.current = spreadCount;
    cancelDrag();
    // The spread list was rebuilt (page pairing or view mode changed). Keep the
    // reader where they were: the owner has already chosen the matching index,
    // so snapping back to the first page would lose their place.
    const clamped = clamp(indexRef.current, 0, Math.max(0, spreadCount - 1));
    if (clamped !== indexRef.current) {
      indexRef.current = clamped;
      setIndex(clamped);
    }
  }, [cancelDrag, spreadCount]);

  // Never leave an animation running after unmount.
  useEffect(() => () => stopAnimation(), [stopAnimation]);

  const subscribeProgress = useCallback((listener: ProgressListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getProgress = useCallback(() => progressRef.current, []);

  const atStart = index <= 0;
  const atEnd = index >= spreadCount - 1;

  return useMemo<FlipEngine>(
    () => ({
      index,
      snapshot,
      atStart,
      atEnd,
      next,
      previous,
      goTo,
      adoptSpreads,
      beginDrag,
      updateDrag,
      endDrag,
      cancelDrag,
      settle,
      subscribeProgress,
      getProgress,
    }),
    [
      atEnd,
      atStart,
      beginDrag,
      cancelDrag,
      endDrag,
      getProgress,
      goTo,
      index,
      next,
      previous,
      settle,
      snapshot,
      subscribeProgress,
    ],
  );
}
