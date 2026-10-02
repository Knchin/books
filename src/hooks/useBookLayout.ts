import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clamp } from '../utils/clamp';
import type { BookGeometry, LayoutMode, ViewMode } from '../types/book';

/** Width, in CSS pixels, below which a two page spread stops being readable. */
export const SPREAD_MIN_WIDTH = 880;
/** Width below which even a comfortable single page needs scrolling. */
export const SINGLE_MIN_WIDTH = 420;

export interface BookLayoutInput {
  availableWidth: number;
  availableHeight: number;
  aspect: number;
  layout: LayoutMode;
  /** True when the viewport is short and wide, e.g. a phone in landscape. */
  compactHeight: boolean;
}

export interface BookLayout {
  viewMode: ViewMode;
  pageWidth: number;
  pageHeight: number;
  bookWidth: number;
  bookHeight: number;
  /** Gap where the spine is. Purely decorative; pages never overlap. */
  spineWidth: number;
}

export const SPINE_RATIO = 0.028;
const SPINE_MIN = 10;
const SPINE_MAX = 46;

/**
 * Decide how big the book should be.
 *
 * Two rules, in priority order:
 *  1. The book must fit the available box - otherwise the reader has to pan to
 *     see it, which is worse than slightly smaller text.
 *  2. A spread must never become so narrow that reading is uncomfortable, so on
 *     a phone we switch to one page instead of shrinking a spread to nothing.
 */
export function computeBookLayout(input: BookLayoutInput): BookLayout {
  const { availableWidth, availableHeight, aspect, layout, compactHeight } = input;

  const safeAspect = aspect > 0.05 ? aspect : 1 / Math.SQRT2;
  const width = Math.max(0, availableWidth);
  const height = Math.max(0, availableHeight);

  let viewMode: ViewMode;
  if (layout === 'spread') viewMode = 'spread';
  else if (layout === 'single') viewMode = 'single';
  else viewMode = resolveAutoView(width, compactHeight);

  if (viewMode === 'spread') {
    const spineWidth = clamp(width * SPINE_RATIO, SPINE_MIN, SPINE_MAX);
    const usableWidth = Math.max(0, width - spineWidth);
    let pageWidth = usableWidth / 2;
    let pageHeight = pageWidth / safeAspect;

    if (pageHeight > height) {
      pageHeight = height;
      pageWidth = pageHeight * safeAspect;
    }

    // Extremely wide documents (slides, panoramas) would otherwise produce a
    // book taller than the screen; cap the height and letterbox the width.
    return {
      viewMode,
      pageWidth,
      pageHeight,
      bookWidth: pageWidth * 2 + spineWidth,
      bookHeight: pageHeight,
      spineWidth,
    };
  }

  let pageWidth = width;
  let pageHeight = pageWidth / safeAspect;
  if (pageHeight > height) {
    pageHeight = height;
    pageWidth = pageHeight * safeAspect;
  }

  return {
    viewMode,
    pageWidth,
    pageHeight,
    bookWidth: pageWidth,
    bookHeight: pageHeight,
    spineWidth: 0,
  };
}

function resolveAutoView(width: number, compactHeight: boolean): ViewMode {
  if (compactHeight) return width >= SPREAD_MIN_WIDTH * 0.75 ? 'spread' : 'single';
  return width >= SPREAD_MIN_WIDTH ? 'spread' : 'single';
}

export interface UseElementSizeOptions {
  /** Skip measuring entirely (e.g. while the reader is closed). */
  enabled?: boolean;
}

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Track an element's content box.
 *
 * Uses `ResizeObserver` where available (every target browser) and falls back to
 * window resize events, because a missing observer must not stop the reader
 * from working.
 */
export function useElementSize<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  options: UseElementSizeOptions = {},
): ElementSize {
  const enabled = options.enabled ?? true;
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((previous) => {
        // Sub-pixel churn would re-render the whole book for nothing.
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        if (previous.width === width && previous.height === height) return previous;
        return { width, height };
      });
    };

    measure();

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [enabled, ref]);

  return size;
}

/** Debounce a rapidly changing value (window resize, zoom slider drags). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(value), delayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [delayMs, value]);

  return debounced;
}

/** Convenience wrapper that keeps the reader's layout in sync with the stage. */
export function useBookLayout(
  stageRef: React.RefObject<HTMLElement | null>,
  geometry: BookGeometry,
  layout: LayoutMode,
  zoom: number,
  enabled: boolean,
): { layout: BookLayout; viewMode: ViewMode } {
  const size = useElementSize(stageRef, { enabled });

  const compactHeight = size.height > 0 && size.height < 520;

  const computed = computeBookLayout({
    availableWidth: size.width,
    availableHeight: size.height,
    aspect: geometry.aspect,
    layout,
    compactHeight,
  });

  const scaled: BookLayout = {
    ...computed,
    pageWidth: computed.pageWidth * zoom,
    pageHeight: computed.pageHeight * zoom,
    bookWidth: computed.bookWidth * zoom,
    bookHeight: computed.bookHeight * zoom,
    spineWidth: computed.spineWidth * zoom,
  };

  return { layout: scaled, viewMode: computed.viewMode };
}