import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { RenderedPage } from '../types/pdf';
import type { PageRenderer } from '../services/pdf/PageRenderer';
import type { PDFDocumentProxy } from '../services/pdf/worker';

export interface RenderedPageState {
  page: RenderedPage | undefined;
  error: string | null;
  /** True while the bitmap has been asked for but is not ready yet. */
  pending: boolean;
}

/**
 * Subscribe one surface to one page.
 *
 * `useSyncExternalStore` is used rather than a `useEffect` + local state so the
 * surface can never paint a stale bitmap after a re-render - the snapshot it
 * reads is always the cache's current answer.
 */
export function useRenderedPage(
  renderer: PageRenderer | null,
  doc: PDFDocumentProxy | null,
  pageNumber: number | null,
  size: { width: number; height: number } | null,
  active: boolean,
): RenderedPageState {
  const requestedRef = useRef<string>('');

  const subscribe = useMemo(
    () => (pageNumber === null || !renderer ? () => () => undefined : (cb: () => void) => renderer.subscribe(pageNumber, cb)),
    [renderer, pageNumber],
  );

  const getSnapshot = useMemo(() => {
    if (pageNumber === null || !renderer) return () => null as RenderedPage | null;
    return () => renderer.peek(pageNumber) ?? null;
  }, [renderer, pageNumber]);

  // `null` is the sentinel `useSyncExternalStore` understands for "nothing yet";
  // normalise it to `undefined` for callers.

  const page = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Re-request whenever the page, the render resolution or the document changes.
  // The render *target* itself is owned by the layout layer, not by each surface:
  // every surface in the book rasterises at the same size, so setting it here
  // would just be the last one to render winning a race.
  useEffect(() => {
    if (!active || !renderer || !doc || pageNumber === null || !size) return;
    if (size.width < 2 || size.height < 2) return;

    const key = `${pageNumber}:${Math.round(size.width)}x${Math.round(size.height)}`;
    if (requestedRef.current === key) return;
    requestedRef.current = key;

    renderer.request(pageNumber);
    renderer.touch(pageNumber);
  }, [active, doc, pageNumber, renderer, size]);

  // Forget the request memo when the surface goes away so a re-attach retries.
  useEffect(() => {
    if (!active) requestedRef.current = '';
  }, [active]);

  useEffect(() => {
    if (!active || pageNumber === null || !renderer) return;
    // Keep this page at the front of the eviction queue while it is on screen.
    renderer.touch(pageNumber);
  }, [active, pageNumber, renderer]);

  const failure = pageNumber !== null && renderer ? renderer.failure(pageNumber) : undefined;

  return useMemo(
    () => ({
      page: page ?? undefined,
      error: failure ? failure.message : null,
      pending: page === null && !failure,
    }),
    [failure, page],
  );
}