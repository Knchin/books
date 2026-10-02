import type { BookFrame, PageNumber, Spread, SpreadMode, ViewMode } from '../../types/book';

/**
 * Build the complete list of spreads for a document.
 *
 * Both spread modes keep one invariant that makes the flip animation honest:
 *
 *   the page that lands on the left is the reverse of the page that lifted off
 *   the right (and vice versa).
 *
 * `book` mode satisfies it with real book pagination - page 1 is the front
 * cover, then sheets are (2,3) (4,5) (6,7).
 * `pair` mode satisfies it with sheets (1,2) (3,4) (5,6), which is the
 * consecutive pairing of a reference layout like `[1][2] [3][4] [5][6]`.
 *
 * Odd and even page counts both work:
 *  - `book`, 6 pages -> [cover] [2,3] [4,5] [6,null]  (blank endpaper on the right)
 *  - `pair`, 6 pages -> [1,2] [3,4] [5,6]
 *  - `book`, 5 pages -> [cover] [2,3] [4,5]
 *
 * Single-page view gets its own list, one page per spread. Reusing the paired
 * list there would silently skip every second page (a book-mode spread {2,3}
 * shows only 2), which is the kind of bug that is invisible until a reader
 * notices they have lost half the document.
 */
export function buildSpreads(
  numPages: number,
  mode: SpreadMode,
  viewMode: ViewMode = 'spread',
): Spread[] {
  if (numPages <= 0) return [];

  if (viewMode === 'single') {
    const spreads: Spread[] = [];
    for (let page = 1; page <= numPages; page += 1) {
      spreads.push({ left: page, right: null, isCover: page === 1 });
    }
    return spreads;
  }

  const spreads: Spread[] = [];

  if (mode === 'book') {
    spreads.push({ left: null, right: 1, isCover: true });
  }

  const first = mode === 'book' ? 2 : 1;
  for (let page = first; page <= numPages; page += 2) {
    const right = page + 1 <= numPages ? page + 1 : null;
    spreads.push({ left: page, right, isCover: false });
  }

  return spreads;
}

/**
 * Rotation as a function of turn progress: `angle = scale * progress + offset`.
 *
 * Kept as data rather than logic because the animation frame needs to produce a
 * number every frame, and it can only do that if the shape of the curve is
 * already fixed. Every entry here starts and ends at a real resting pose, which
 * is what lets a spring-back interrupt a turn mid-flight without a jump.
 */
const ANGLE = {
  /** At rest. */
  idle: { scale: 0, offset: 0 },
  /** Opening the cover: 0deg (closed) to -180deg (lying on the left). */
  open: { scale: -180, offset: 0 },
  /** Closing the cover: -180deg back to 0deg. */
  close: { scale: 180, offset: -180 },
  /** A right-hand page lifting and landing on the left. */
  forward: { scale: -180, offset: 0 },
  /** A left-hand page lifting and landing on the right. */
  backward: { scale: 180, offset: 0 },
} as const;

type Angle = (typeof ANGLE)[keyof typeof ANGLE];

function frame(
  partial: Omit<BookFrame, 'angleScale' | 'angleOffset'>,
  angle: Angle,
): BookFrame {
  return { ...partial, angleScale: angle.scale, angleOffset: angle.offset };
}

/**
 * Resolve the concrete page surfaces for a frame.
 *
 * `progress` is intentionally *not* an input: the DOM structure of a turn is
 * fixed for its whole duration, so React builds it once when the turn starts.
 * Only the rotation is animated, and that is written straight to CSS custom
 * properties from inside the animation frame.
 */
export function resolveFrame(
  spreads: Spread[],
  kind: 'idle' | 'turn' | 'open' | 'close',
  direction: 1 | -1,
  fromIndex: number,
  toIndex: number,
  index: number,
  viewMode: ViewMode,
): BookFrame {
  const at = (value: number): Spread | undefined =>
    spreads[Math.max(0, Math.min(spreads.length - 1, value))];

  // ---- Single page view --------------------------------------------------
  // Checked first: a lone page has no facing page to land on, so it cannot be
  // modelled as a rigid sheet at all. It slides away instead. The cover takes
  // part in the same slide, which is why there is no separate cover path here -
  // rotating a cover by 180deg about a page edge would simply move it off the
  // page entirely.
  if (viewMode === 'single') {
    if (kind !== 'turn') {
      const spread = at(index);
      return frame(
        {
          left: spread?.left ?? null,
          right: null,
          sheetFront: null,
          sheetBack: null,
          sheetSpan: 'full',
          hinge: 'left',
          rigid: true,
          cover: false,
        },
        ANGLE.idle,
      );
    }

    const front = direction === 1 ? pageOf(at(fromIndex)) : pageOf(at(toIndex));
    const back = direction === 1 ? pageOf(at(toIndex)) : pageOf(at(fromIndex));
    return frame(
      {
        // The incoming page is already in the block; the sheet slides off it.
        left: back,
        right: null,
        sheetFront: front,
        sheetBack: null,
        sheetSpan: 'full',
        hinge: direction === 1 ? 'left' : 'right',
        rigid: false,
        cover: front === 1 || back === 1,
      },
      ANGLE.idle,
    );
  }

  // ---- Opening / closing the cover ---------------------------------------
  // The cover is one board wide, hinged on the spine, exactly like the front
  // board of a hardback: it lies over the right page when closed and lands over
  // the left page when open. Its reverse is page 2 - the same page the block
  // reveals underneath it - so the two overlap seamlessly at the end of the
  // turn and removing the sheet is invisible.
  if (kind === 'open' || kind === 'close') {
    const inner = spreads[1] ?? spreads[0];
    return frame(
      {
        left: inner?.left ?? null,
        right: inner?.right ?? null,
        sheetFront: 1,
        sheetBack: inner?.left ?? 2,
        sheetSpan: 'right',
        hinge: 'left',
        rigid: true,
        cover: true,
      },
      kind === 'open' ? ANGLE.open : ANGLE.close,
    );
  }

  const from = at(fromIndex);
  const to = at(toIndex);

  // ---- At rest ------------------------------------------------------------
  if (kind === 'idle') {
    const spread = at(index);
    if (!spread) {
      return frame(
        {
          left: null,
          right: null,
          sheetFront: null,
          sheetBack: null,
          sheetSpan: 'full',
          hinge: 'left',
          rigid: true,
          cover: false,
        },
        ANGLE.idle,
      );
    }
    if (spread.isCover) {
      // Closed: the inside front cover on the left, the front board on the right.
      // Showing page 2 here (rather than a blank) means opening the cover changes
      // nothing until the sheet actually lifts, so there is no pop at the start
      // of the animation.
      const inner = spreads[1];
      return frame(
        {
          left: inner?.left ?? null,
          right: 1,
          sheetFront: 1,
          sheetBack: inner?.left ?? 2,
          sheetSpan: 'right',
          hinge: 'left',
          rigid: true,
          cover: true,
        },
        ANGLE.idle,
      );
    }
    return frame(
      {
        left: spread.left,
        right: spread.right,
        sheetFront: null,
        sheetBack: null,
        sheetSpan: 'full',
        hinge: 'left',
        rigid: true,
        cover: false,
      },
      ANGLE.idle,
    );
  }

  // ---- Two page turn ------------------------------------------------------
  if (direction === 1) {
    // The right page lifts. Underneath, the next spread's left page is revealed
    // - which is also the reverse of this sheet - and the next right page shows.
    return frame(
      {
        left: from?.left ?? to?.left ?? null,
        right: to?.right ?? null,
        sheetFront: from?.right ?? null,
        sheetBack: to?.left ?? null,
        sheetSpan: 'right',
        hinge: 'left',
        rigid: true,
        cover: false,
      },
      ANGLE.forward,
    );
  }

  // The left page lifts. Its reverse is the previous spread's right page, which
  // is exactly what the block reveals underneath it.
  return frame(
    {
      left: to?.left ?? null,
      right: to?.right ?? null,
      sheetFront: from?.left ?? null,
      sheetBack: to?.right ?? null,
      sheetSpan: 'left',
      hinge: 'right',
      rigid: true,
      cover: false,
    },
    ANGLE.backward,
  );
}

/** All page numbers a spread occupies, left to right, skipping blanks. */
export function spreadPages(spread: Spread | undefined): PageNumber[] {
  if (!spread) return [];
  const pages: PageNumber[] = [];
  if (spread.left !== null) pages.push(spread.left);
  if (spread.right !== null) pages.push(spread.right);
  return pages;
}

/** Every page a frame needs on screen, in draw order and de-duplicated. */
export function framePages(value: BookFrame): PageNumber[] {
  const pages: PageNumber[] = [];
  for (const page of [value.left, value.right, value.sheetFront, value.sheetBack]) {
    if (page !== null && !pages.includes(page)) pages.push(page);
  }
  return pages;
}

/** Human readable description of what is on screen, for screen readers. */
export function describeSpread(spread: Spread | undefined): string {
  if (!spread) return 'No page';
  if (spread.isCover) return 'Front cover';
  if (spread.left === null) return spread.right ? `Page ${spread.right}` : 'Blank';
  if (spread.right === null) return `Page ${spread.left}`;
  return `Pages ${spread.left} and ${spread.right}`;
}

/** Map a 1-based PDF page number to the spread index that shows it. */
export function spreadIndexForPage(spreads: Spread[], page: PageNumber): number {
  for (let i = 0; i < spreads.length; i += 1) {
    const spread = spreads[i];
    if (spread.isCover && page === 1) return i;
    if (!spread.isCover && (spread.left === page || spread.right === page)) return i;
  }
  return 0;
}

/** The page a spread leads with. For single-page spreads this is the only page. */
function pageOf(spread: Spread | undefined): PageNumber | null {
  if (!spread) return null;
  if (spread.isCover) return spread.right;
  return spread.left ?? spread.right;
}