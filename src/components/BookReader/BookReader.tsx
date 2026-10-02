import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Book } from './Book';
import { clamp, quantize } from '../../utils/clamp';
import { DEFAULT_GESTURES, useBookGestures } from '../../hooks/useBookGestures';
import type { FlipEngine } from '../../hooks/useFlipEngine';
import type { PageRenderer } from '../../services/pdf/PageRenderer';
import type { PDFDocumentProxy } from '../../services/pdf/worker';
import type { BookLayout } from '../../hooks/useBookLayout';
import type { Spread, ViewMode } from '../../types/book';

export interface BookReaderProps {
  spreads: Spread[];
  engine: FlipEngine;
  renderer: PageRenderer | null;
  doc: PDFDocumentProxy | null;
  layout: BookLayout;
  viewMode: ViewMode;
  zoom: number;
  reducedMotion: boolean;
  onZoomChange: (zoom: number) => void;
  /** Any pointer or keyboard interaction, used to wake the toolbar. */
  onUserGesture: () => void;
}

export const MAX_ZOOM = 4;
const MIN_ZOOM = 1;
const DOUBLE_TAP_ZOOM = 2;
/** Zoom step for the toolbar buttons and Ctrl+wheel. */
const ZOOM_STEP = 0.2;
/**
 * While zoomed in, the whole surface pans, so a page turn can only start from
 * the outer strip of a page - the same edge-peel gesture a reader uses on a
 * magnified physical book.
 */
const EDGE_PEEL = 0.14;

export { ZOOM_STEP };

/**
 * The reading surface: the stage, the zoom and pan model, and every gesture.
 *
 * Zoom is a CSS transform on the book, never a change to the rasterised pages.
 * That separation is deliberate: turning a page never waits on a re-render, and
 * zooming never invalidates the bitmap cache. When the reader zooms far enough
 * that a cached bitmap would look soft, the layout layer asks for a sharper
 * render in the background while the existing one stays on screen.
 */
export function BookReader({
  spreads,
  engine,
  renderer,
  doc,
  layout,
  viewMode,
  zoom,
  reducedMotion,
  onZoomChange,
  onUserGesture,
}: BookReaderProps) {
  // A callback ref (rather than an object ref read during render) so the gesture
  // hook always attaches to a real element, including on the first render.
  const [stage, setStage] = useState<HTMLDivElement | null>(null);

  const panRef = useRef<{ startX: number; startY: number; left: number; top: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const pinchRef = useRef<{ startZoom: number } | null>(null);

  const isSpread = viewMode === 'spread';
  const zoomed = zoom > 1.001;
  const pageWidth = layout.pageWidth / zoom;
  const pageHeight = layout.pageHeight / zoom;
  const spineWidth = layout.spineWidth / zoom;

  const applyZoom = useCallback(
    (next: number, options?: { keepCentre?: boolean }) => {
      const clamped = quantize(clamp(next, MIN_ZOOM, MAX_ZOOM), 0.05);
      if (Math.abs(clamped - zoom) < 0.001) return;
      onZoomChange(clamped);

      if (options?.keepCentre && stage) {
        // Re-centre after the sizer has been resized to the new scale.
        requestAnimationFrame(() => {
          stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
          stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
        });
      }
    },
    [onZoomChange, stage, zoom],
  );

  const zoomChangeRef = useRef(applyZoom);
  zoomChangeRef.current = applyZoom;

  // Centre the book whenever it fits, and reset the scroll when it shrinks
  // below the viewport (closing the thumbnail panel, rotating a phone...).
  useEffect(() => {
    if (!stage) return;
    stage.scrollLeft = 0;
    stage.scrollTop = 0;
  }, [stage, isSpread]);

  // Ctrl/Cmd + wheel zooms, matching every other document reader. A plain wheel
  // still scrolls, which is what makes panning a zoomed book feel ordinary.
  useEffect(() => {
    if (!stage) return undefined;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      onUserGesture();
      const factor = Math.exp(-event.deltaY * 0.002);
      zoomChangeRef.current(zoom * factor, { keepCentre: true });
    };

    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [onUserGesture, stage]);

  const gestureHandlers = useMemo(
    () => ({
      onDragStart: (
        side: 'left' | 'right',
        clientX: number,
        clientY: number,
        pageWidth: number,
      ): boolean => {
        onUserGesture();
        if (zoomed) {
          // Pan owns the surface; only the outer strip can still peel a page.
          const rect = stage?.getBoundingClientRect();
          const localX = rect ? clientX - rect.left : 0;
          const withinPage = side === 'right' ? localX - pageWidth : localX;
          if (withinPage > pageWidth * EDGE_PEEL) {
            if (stage) {
              panRef.current = {
                startX: clientX,
                startY: clientY,
                left: stage.scrollLeft,
                top: stage.scrollTop,
              };
              setPanning(true);
            }
            return false;
          }
        }
        return engine.beginDrag(side, clientX, pageWidth);
      },

      onDragMove: (x: number, y: number) => {
        const pan = panRef.current;
        if (pan && stage) {
          // Direct 1:1 panning of a zoomed book.
          stage.scrollLeft = pan.left - (x - pan.startX);
          stage.scrollTop = pan.top - (y - pan.startY);
          return;
        }
        engine.updateDrag(x);
      },

      onDragEnd: () => {
        panRef.current = null;
        setPanning(false);
        engine.endDrag();
      },

      onTap: (side: 'left' | 'right', inEdgeZone: boolean) => {
        onUserGesture();
        // Zoomed in, a tap in the middle of the page must not keep turning pages
        // while the reader is trying to read one.
        if (zoomed && !inEdgeZone) return;
        if (engine.snapshot.phase !== 'idle') return;
        if (side === 'right') engine.next();
        else engine.previous();
      },

      onPinch: (scale: number) => {
        onUserGesture();
        if (!pinchRef.current) pinchRef.current = { startZoom: zoom };
        applyZoom(pinchRef.current.startZoom * scale, { keepCentre: true });
      },

      onPinchEnd: () => {
        pinchRef.current = null;
      },

      onDoubleTap: () => {
        onUserGesture();
        applyZoom(zoom > 1.5 ? MIN_ZOOM : DOUBLE_TAP_ZOOM, { keepCentre: true });
      },
    }),
    [applyZoom, engine, onUserGesture, stage, zoom, zoomed],
  );

  useBookGestures(stage, gestureHandlers, DEFAULT_GESTURES);

  // Keep the reading position centred after a layout change (rotation, resize).
  useLayoutEffect(() => {
    if (!stage) return;
    if (zoomed) {
      stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
      stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
    }
  }, [layout.bookWidth, layout.bookHeight, stage, zoomed]);

  const bookWidth = layout.bookWidth / zoom;
  const bookHeight = layout.bookHeight / zoom;

  return (
    <div
      ref={setStage}
      className="stage"
      data-panning={panning ? 'true' : 'false'}
      data-zoomed={zoomed ? 'true' : 'false'}
      role="application"
      aria-roledescription="book reader"
      aria-label="Book pages. Use the left and right arrow keys to turn pages."
    >
      <div
        className="stage__sizer"
        style={{ width: `${Math.round(bookWidth)}px`, height: `${Math.round(bookHeight)}px` }}
      >
        <Book
          spreads={spreads}
          index={engine.index}
          engine={engine}
          renderer={renderer}
          doc={doc}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          spineWidth={spineWidth}
          viewMode={viewMode}
          reducedMotion={reducedMotion}
          flat={!isSpread}
        />
      </div>
    </div>
  );
}