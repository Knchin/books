import { memo, useEffect, useRef } from 'react';
import { useRenderedPage } from '../../hooks/useRenderedPage';
import type { PageRenderer } from '../../services/pdf/PageRenderer';
import type { PDFDocumentProxy } from '../../services/pdf/worker';
import type { PageNumber } from '../../types/book';

export interface PageSurfaceProps {
  pageNumber: PageNumber | null;
  renderer: PageRenderer | null;
  doc: PDFDocumentProxy | null;
  /** CSS size of the slot this page will be painted into. */
  size: { width: number; height: number } | null;
  /** False for pages that exist but are nowhere near the reading position. */
  active: boolean;
  /** Show the printed page number in the corner. */
  showLabel?: 'left' | 'right' | null;
  /** Accessible description; omit for decorative duplicates. */
  label?: string;
}

function PageSurfaceImpl({
  pageNumber,
  renderer,
  doc,
  size,
  active,
  showLabel = null,
  label,
}: PageSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { page, error, pending } = useRenderedPage(renderer, doc, pageNumber, size, active);

  // Blit the cached bitmap into the display canvas.
  //
  // Drawing into a display canvas rather than mounting the cached canvas keeps
  // three things true at once: the cache entry can be swapped for a sharper
  // render without remounting anything, several surfaces can look at the same
  // page, and the cache is free to evict a bitmap that is still in the DOM
  // without leaving a blank rectangle behind.
  useEffect(() => {
    const target = canvasRef.current;
    if (!target) return;

    if (!page) {
      const context = target.getContext('2d');
      if (context) context.clearRect(0, 0, target.width, target.height);
      return;
    }

    const source = page.canvas;
    if (target.width !== source.width || target.height !== source.height) {
      target.width = source.width;
      target.height = source.height;
    }

    const context = target.getContext('2d', { alpha: false });
    if (!context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, target.width, target.height);
    context.drawImage(source, 0, 0);
  }, [page]);

  if (pageNumber === null) {
    return (
      <div className="page-surface" aria-hidden="true">
        <div className="page-blank" />
      </div>
    );
  }

  return (
    <div className="page-surface" role={label ? 'img' : undefined} aria-label={label}>
      {page ? (
        <canvas
          ref={canvasRef}
          className="page-canvas"
          aria-hidden={label ? undefined : 'true'}
        />
      ) : error ? (
        <p className="page-failed">
          <strong>Page {pageNumber}</strong>
          <span>{error}</span>
        </p>
      ) : pending ? (
        <div className="page-skeleton" aria-hidden="true" />
      ) : null}
      {showLabel ? (
        <span className={`page-label page-label--${showLabel}`} aria-hidden="true">
          {pageNumber}
        </span>
      ) : null}
    </div>
  );
}

/**
 * One page of the book.
 *
 * Memoised on the values that actually change what it draws, so a progress
 * update on the sheet never re-renders a page that is not moving. This is what
 * keeps a turn at 60fps with four surfaces on screen.
 */
export const PageSurface = memo(PageSurfaceImpl);