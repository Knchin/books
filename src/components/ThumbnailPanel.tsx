import { memo, useEffect, useRef, useState } from 'react';
import { useRenderedPage } from '../hooks/useRenderedPage';
import { CloseIcon } from './Icons';
import type { PageNumber } from '../types/book';
import type { PageRenderer } from '../services/pdf/PageRenderer';
import type { PDFDocumentProxy } from '../services/pdf/worker';

export interface ThumbnailItemProps {
  pageNumber: PageNumber;
  /** Width the thumbnail displays at; the render request derives DPR from it. */
  width: number;
  aspectRatio: number;
  renderer: PageRenderer | null;
  doc: PDFDocumentProxy | null;
  active: boolean;
  onSelect: (pageNumber: PageNumber) => void;
}

/**
 * One page in the filmstrip.
 *
 * Mounting does not mean rendering. An `IntersectionObserver` requests a bitmap
 * only once the tile is within half a screen of the viewport, so a 900 page
 * document costs a dozen bitmaps instead of nine hundred. The generous margin is
 * what keeps scrolling continuous: the next tiles are decoded before they
 * scroll in, and the observer disconnects after the first hit, so a decoded tile
 * never drops its bitmap when it leaves the viewport.
 */
function ThumbnailItemImpl({
  pageNumber,
  width,
  aspectRatio,
  renderer,
  doc,
  active,
  onSelect,
}: ThumbnailItemProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const node = buttonRef.current;
    if (!node) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      // Without the API, rendering every tile is the only way to show a panel.
      setNearViewport(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const paperWidth = Math.round(width);
  const paperHeight = Math.round(width * aspectRatio);

  const rendered = useRenderedPage(
    renderer,
    doc,
    pageNumber,
    // Rendered through the renderer's own target, so the request matches the
    // thumbnail lane's configured box rather than the screen lane's.
    { width: paperWidth, height: paperHeight },
    nearViewport,
  );

  return (
    <button
      ref={buttonRef}
      type="button"
      className="thumbnail"
      data-active={active ? 'true' : 'false'}
      data-loaded={rendered.page ? 'true' : 'false'}
      data-failed={rendered.error ? 'true' : 'false'}
      data-pending={rendered.pending && !rendered.page ? 'true' : 'false'}
      onClick={() => onSelect(pageNumber)}
      aria-label={`Go to page ${pageNumber}`}
      aria-current={active ? 'true' : undefined}
      title={`Page ${pageNumber}`}
    >
      <span className="thumbnail__paper" style={{ width: `${paperWidth}px`, height: `${paperHeight}px` }}>
        {rendered.page ? (
          <ThumbnailCanvas source={rendered.page.canvas} pageNumber={pageNumber} />
        ) : rendered.error ? (
          <span className="thumbnail__error" aria-hidden="true">
            !
          </span>
        ) : (
          <span className="thumbnail__skeleton" aria-hidden="true" />
        )}
      </span>

      <span className="thumbnail__number">{pageNumber}</span>
    </button>
  );
}

/**
 * Blits the cached bitmap onto the visible canvas. The copy runs in an effect so
 * it happens once per new bitmap; scrolling the filmstrip never repaints tiles
 * whose page has not changed.
 */
function ThumbnailCanvas({
  source,
  pageNumber,
}: {
  source: HTMLCanvasElement;
  pageNumber: PageNumber;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const context = node.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, node.width, node.height);
    context.drawImage(source, 0, 0);
  }, [source]);

  return (
    <canvas
      ref={canvasRef}
      className="thumbnail__canvas"
      width={source.width}
      height={source.height}
      role="img"
      aria-label={`Page ${pageNumber} thumbnail`}
    />
  );
}

export const ThumbnailItem = memo(ThumbnailItemImpl);

export interface ThumbnailPanelProps {
  pages: number;
  currentPage: PageNumber;
  aspectRatio: number;
  width: number;
  renderer: PageRenderer | null;
  doc: PDFDocumentProxy | null;
  visible: boolean;
  onSelect: (page: PageNumber) => void;
  onClose: () => void;
}

/**
 * The page filmstrip.
 *
 * A `<nav>` of real buttons, so Tab moves between pages and every tile has an
 * accessible name. Only the active page is scrolled into view, and only when it
 * is off screen - doing that on every turn would fight the reader's own
 * scrolling.
 */
export function ThumbnailPanel({
  pages,
  currentPage,
  aspectRatio,
  width,
  renderer,
  doc,
  visible,
  onSelect,
  onClose,
}: ThumbnailPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!visible) return;
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('.thumbnail[data-active="true"]');
    if (!list || !active) return;

    const top = active.offsetTop;
    const view = list.clientHeight;
    if (top < list.scrollTop || top > list.scrollTop + view - active.offsetHeight) {
      list.scrollTo({
        top: top - view / 2 + active.offsetHeight / 2,
        behavior: 'smooth',
      });
    }
  }, [currentPage, visible]);

  if (!visible) return null;

  return (
    <nav className="thumbnails" aria-label="Pages" data-no-gesture="true">
      <div className="thumbnails__header">
        <h2 className="thumbnails__title">Pages</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Hide thumbnails"
          title="Hide thumbnails (F)"
        >
          <CloseIcon width={16} height={16} />
        </button>
      </div>

      <div className="thumbnails__list" ref={listRef}>
        {Array.from({ length: pages }, (_, index) => {
          const pageNumber = (index + 1) as PageNumber;
          return (
            <ThumbnailItem
              key={pageNumber}
              pageNumber={pageNumber}
              width={width}
              aspectRatio={aspectRatio}
              renderer={renderer}
              doc={doc}
              active={pageNumber === currentPage}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </nav>
  );
}