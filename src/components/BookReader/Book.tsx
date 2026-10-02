import { useEffect, useMemo, useRef } from 'react';
import { FacingSheet, PageSlot } from './FacingSheet';
import { describeSpread, resolveFrame } from '../../services/pdf/spreads';
import type { PageRenderer } from '../../services/pdf/PageRenderer';
import type { PDFDocumentProxy } from '../../services/pdf/worker';
import type { BookFrame, Spread, ViewMode } from '../../types/book';
import type { FlipEngine } from '../../hooks/useFlipEngine';

export interface BookProps {
  spreads: Spread[];
  index: number;
  engine: FlipEngine;
  renderer: PageRenderer | null;
  doc: PDFDocumentProxy | null;
  pageWidth: number;
  pageHeight: number;
  spineWidth: number;
  viewMode: ViewMode;
  reducedMotion: boolean;
  /** Drop the slight overall yaw, e.g. when the book is tiny. */
  flat?: boolean;
}

const EMPTY_FRAME: BookFrame = {
  left: null,
  right: null,
  sheetFront: null,
  sheetBack: null,
  sheetSpan: 'full',
  hinge: 'left',
  rigid: true,
  cover: false,
  angleScale: 0,
  angleOffset: 0,
};

/**
 * The book itself.
 *
 * The load-bearing job here is the animation channel. React renders the *shape*
 * of a turn once, when the turn begins. From then on the flip engine calls the
 * imperative subscriber below on every animation frame, and it does nothing but
 * write five custom properties onto `.book`. CSS derives the rotation, the
 * specular band and both cast shadows from those. No React render ever happens
 * per frame, which is what keeps a turn at 60fps while PDF.js is rasterising
 * pages in the worker.
 */
export function Book({
  spreads,
  index,
  engine,
  renderer,
  doc,
  pageWidth,
  pageHeight,
  spineWidth,
  viewMode,
  reducedMotion,
  flat = false,
}: BookProps) {
  const bookRef = useRef<HTMLDivElement | null>(null);
  const { snapshot, subscribeProgress, getProgress } = engine;

  const frame = useMemo(
    () =>
      spreads.length > 0
        ? resolveFrame(
            spreads,
            snapshot.frame,
            snapshot.direction,
            snapshot.fromIndex,
            snapshot.toIndex,
            index,
            viewMode,
          )
        : EMPTY_FRAME,
    [
      index,
      snapshot.direction,
      snapshot.frame,
      snapshot.fromIndex,
      snapshot.toIndex,
      spreads,
      viewMode,
    ],
  );

  useEffect(() => {
    const element = bookRef.current;
    if (!element) return undefined;

    const apply = (progress: number) => {
      // Rotate the sheet about its hinge.
      const angle = frame.angleScale * progress + frame.angleOffset;
      // Triangle term: 1 at the halfway point, 0 at both ends. A page passing
      // through a light source, rather than a div being rotated.
      const light = 1 - Math.abs(progress - 0.5) * 2;
      const active = progress > 0.0005 && progress < 0.9995 ? 1 : 0;

      element.style.setProperty('--fp', progress.toFixed(4));
      element.style.setProperty('--fa', `${angle.toFixed(3)}deg`);
      element.style.setProperty('--fl', light.toFixed(4));
      element.style.setProperty('--flip-active', String(active));
    };

    apply(getProgress());
    return subscribeProgress(apply);
    // The angle parameters only change when the *shape* of the turn changes,
    // which is exactly when React re-renders anyway.
  }, [frame.angleOffset, frame.angleScale, getProgress, reducedMotion, subscribeProgress]);

  const isActive = snapshot.phase === 'dragging' || snapshot.phase === 'animating';
  const flipDirection = snapshot.direction === 1 ? 'forward' : 'backward';
  const currentSpread = spreads[index];
  const isClosedCover = frame.cover && snapshot.frame === 'idle';

  const size = useMemo(
    () => (pageWidth > 1 && pageHeight > 1 ? { width: pageWidth, height: pageHeight } : null),
    [pageHeight, pageWidth],
  );

  /**
   * The cover board is wider than a page - it spans a whole face of the case -
   * so rasterising it at page size and stretching it to the sheet would look
   * soft. Pages underneath keep the ordinary page-sized box.
   */
  const coverSize = useMemo(() => {
    const full = pageWidth * 2 + spineWidth;
    return full > 1 && pageHeight > 1 ? { width: full, height: pageHeight } : null;
  }, [pageHeight, pageWidth, spineWidth]);

  const bookWidth =
    Math.max(1, Math.round(pageWidth * (viewMode === 'single' ? 1 : 2) + spineWidth));

  return (
    <>
      {/*
        The rendered pages are decorative from a screen reader's point of view:
        the same information is available as text in the page indicator and the
        live region below. Announcing four canvases per spread would be noise.
      */}
      <div className={flat ? 'book-view book-view--flat' : 'book-view'} aria-hidden="true">
        <div
          ref={bookRef}
          className="book"
          style={
            {
              width: `${bookWidth}px`,
              height: `${Math.max(1, Math.round(pageHeight))}px`,
              '--spine-w': `${Math.max(0, Math.round(spineWidth))}px`,
            } as React.CSSProperties
          }
          data-view={viewMode}
          data-flip={isActive ? flipDirection : 'none'}
          data-cover={isClosedCover ? 'closed' : 'open'}
          data-motion={reducedMotion ? 'reduced' : 'full'}
        >
          <div className="book__block" />

          <PageSlot
            pageNumber={frame.left}
            side={viewMode === 'single' ? 'full' : 'left'}
            renderer={renderer}
            doc={doc}
            size={size}
            active
            showLabel={viewMode === 'spread'}
          />

          {viewMode === 'spread' ? (
            <PageSlot
              pageNumber={frame.right}
              side="right"
              renderer={renderer}
              doc={doc}
              size={size}
              active
              showLabel
            />
          ) : null}

          <div className="turn-shadow turn-shadow--from" />
          <div className="turn-shadow turn-shadow--to" />

          {frame.sheetFront !== null || frame.sheetBack !== null ? (
            <FacingSheet
              front={frame.sheetFront}
              back={frame.sheetBack}
              span={frame.sheetSpan}
              hinge={frame.hinge}
              rigid={frame.rigid}
              cover={frame.cover}
              renderer={renderer}
              doc={doc}
              size={frame.cover ? coverSize : size}
              backSize={size}
              active
            />
          ) : null}

          {viewMode === 'spread' ? <div className="spine" /> : null}
        </div>
      </div>

      <p className="visually-hidden" aria-live="polite" data-book-announcer>
        {describeSpread(currentSpread)}
      </p>
    </>
  );
}