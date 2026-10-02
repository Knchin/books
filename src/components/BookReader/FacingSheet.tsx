import { memo } from 'react';
import { PageSurface } from './PageSurface';
import type { PageRenderer } from '../../services/pdf/PageRenderer';
import type { PDFDocumentProxy } from '../../services/pdf/worker';
import type { BookFrame } from '../../types/book';
import type { PageNumber } from '../../types/book';

export interface PageSlotProps {
  pageNumber: PageNumber | null;
  side: 'left' | 'right' | 'full';
  renderer: PageRenderer | null;
  doc: PDFDocumentProxy | null;
  size: { width: number; height: number } | null;
  active: boolean;
  showLabel?: boolean;
  label?: string;
}

/**
 * A page lying flat in the block.
 *
 * Rendering order inside `.book` is the z-order during a turn, and it is
 * identical for both directions:
 *
 *   left slot -> right slot -> cast shadow -> sheet
 *
 * The sheet is always last, because during any single turn the lifting sheet is
 * always the frontmost object - it comes off the block and settles onto it, it
 * never passes underneath.
 */
function PageSlotImpl({
  pageNumber,
  side,
  renderer,
  doc,
  size,
  active,
  showLabel = false,
  label,
}: PageSlotProps) {
  const className =
    side === 'full' ? 'page-slot page-slot--full' : `page-slot page-slot--${side}`;

  return (
    <div className={className}>
      <PageSurface
        pageNumber={pageNumber}
        renderer={renderer}
        doc={doc}
        size={size}
        active={active}
        showLabel={showLabel ? (side === 'right' ? 'right' : 'left') : null}
        label={label}
      />
    </div>
  );
}

export const PageSlot = memo(PageSlotImpl);

export interface FacingSheetProps {
  front: PageNumber | null;
  back: PageNumber | null;
  /** Which half of the book the sheet occupies at rest. */
  span: BookFrame['sheetSpan'];
  /** Which edge the sheet is hinged on; decides which way a slide leaves. */
  hinge: BookFrame['hinge'];
  /** False for the single-page slide, which has no reverse and does not rotate. */
  rigid: boolean;
  cover: boolean;
  renderer: PageRenderer | null;
  doc: PDFDocumentProxy | null;
  /** Box the front face is rasterised for. */
  size: { width: number; height: number } | null;
  /** Box the back face is rasterised for; defaults to `size`. */
  backSize?: { width: number; height: number } | null;
  active: boolean;
}

/**
 * The sheet that lifts off the book.
 *
 * Two faces, back to back, each with `backface-visibility: hidden`; the rear one
 * is pre-rotated 180deg so the browser mirrors it automatically. That mirroring
 * is not a flourish: without it, the reverse of a turning page would show text
 * running backwards.
 *
 * The lighting layers are children of each face rather than of the sheet,
 * because `mix-blend-mode` inside a `preserve-3d` context would composite
 * against the wrong plane.
 */
function FacingSheetImpl({
  front,
  back,
  span,
  hinge,
  rigid,
  cover,
  renderer,
  doc,
  size,
  backSize,
  active,
}: FacingSheetProps) {
  if (front === null && back === null) return null;

  const classes = [
    'sheet',
    `sheet--${span}`,
    rigid ? 'sheet--rigid' : 'sheet--slide',
    cover ? 'sheet--cover' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      aria-hidden="true"
      data-no-gesture="true"
      // A slide leaves towards its hinge, so the direction lives in the DOM and
      // the transform stays a pure function of `--fp`.
      data-hinge={hinge}
      style={rigid ? undefined : ({ '--slide-x': hinge === 'left' ? '-1' : '1' } as React.CSSProperties)}
    >
      <div className="sheet__face sheet__face--front">
        <PageSurface
          pageNumber={front}
          renderer={renderer}
          doc={doc}
          size={size}
          active={active}
        />
        <div className="sheet__light" />
        <div className="sheet__curl" />
      </div>

      {/*
        A sliding page never turns over, so its reverse is never on screen.
        Not rendering it also avoids asking the renderer for a bitmap that would
        only ever be thrown away.
      */}
      {rigid && back !== null ? (
        <div className="sheet__face sheet__face--back">
          <PageSurface
            pageNumber={back}
            renderer={renderer}
            doc={doc}
            size={backSize ?? size}
            active={active}
          />
          <div className="sheet__light" />
          <div className="sheet__curl" />
        </div>
      ) : null}
    </div>
  );
}

export const FacingSheet = memo(FacingSheetImpl);