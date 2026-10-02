/**
 * Domain model for the "book" abstraction that sits on top of a flat PDF page
 * list.
 *
 * A real book is a sequence of *sheets*. Each sheet has a front (recto) and a
 * back (verso). Reading a two page spread means looking at the back of one sheet
 * on the left and the front of the next sheet on the right. Keeping that
 * relationship explicit is what makes the page-flip animation physically
 * correct: the number you see when a page lands is literally the reverse of the
 * number that lifted away.
 */

/** 1-based PDF page number. */
export type PageNumber = number;

/** A single two-page view. `null` means "no page here" (blank endpaper). */
export interface Spread {
  left: PageNumber | null;
  right: PageNumber | null;
  /** The very first spread of a `book` document is the closed front cover. */
  isCover: boolean;
}

/**
 * How PDF pages are grouped into spreads.
 *
 * - `book`  : page 1 is the front cover, then spreads are [2,3] [4,5] [6,7].
 *             This is how a physical book is actually paginated and is the
 *             only layout where a flip is physically honest (front of a sheet
 *             turns to become its back).
 * - `pair`  : spreads are [1,2] [3,4] [5,6]. Also physically consistent
 *             (each sheet is (2n, 2n+1)), it simply has no separate cover.
 */
export type SpreadMode = 'book' | 'pair';

/** One page per view. Used on phones and when the user forces single page. */
export type ViewMode = 'spread' | 'single';

/** Direction of a page turn: 1 = forward, -1 = backward. */
export type FlipDirection = 1 | -1;

/** How the reader chooses between `spread` and `single`. */
export type LayoutMode = 'auto' | ViewMode;

/**
 * How a turn is being rendered, independent of whether a finger or the tween is
 * driving it. Opening the cover and closing it are distinct from a page turn
 * because a hardcover's front board spans the whole case, not one page.
 */
export type FrameKind = 'idle' | 'turn' | 'open' | 'close';

/**
 * A snapshot of the flip engine.
 *
 * These fields change only a handful of times per turn. The continuous
 * `progress` value is deliberately *not* React state: it is written straight to
 * CSS custom properties from inside the animation frame, so React never
 * re-renders per frame.
 */
export interface FlipSnapshot {
  /** What is driving the turn right now. */
  phase: 'idle' | 'dragging' | 'animating';
  /** What kind of turn it is. */
  frame: FrameKind;
  direction: FlipDirection;
  /** Spread index the turn starts from. */
  fromIndex: number;
  /** Spread index the turn lands on. */
  toIndex: number;
  /**
   * 0 = the sheet is exactly where it started, 1 = it has fully landed.
   * Opening, both turn directions and closing all share this convention, which
   * is what lets every gesture use one code path.
   */
  progress: number;
}

/** One frame of the book: which page goes on which surface. */
export interface BookFrame {
  /** Page in the static left slot. */
  left: PageNumber | null;
  /** Page in the static right slot. */
  right: PageNumber | null;
  /** Face of the sheet that lifts off the book. */
  sheetFront: PageNumber | null;
  /** Face revealed as the sheet rotates away. */
  sheetBack: PageNumber | null;
  /** Which part of the book the lifting sheet occupies at rest. */
  sheetSpan: 'left' | 'right' | 'full';
  /** Edge the sheet rotates around. */
  hinge: 'left' | 'right';
  /** Rotate as a rigid book turn, or sweep away as a slide (single page view). */
  rigid: boolean;
  /** The frame involves the closed front board. */
  cover: boolean;
  /**
   * Angle in degrees is `progress * angleScale + angleOffset`.
   *
   * Defining it this way makes `progress` mean exactly one thing everywhere:
   * how far the sheet has travelled from where it started (0) to where it lands
   * (1). Opening, a forward turn, a backward turn and closing the book all use
   * 0 -> 1, which in turn means every gesture - tween or finger drag - can share
   * one code path.
   */
  angleScale: number;
  angleOffset: number;
}

export interface BookGeometry {
  /** Aspect ratio (width / height) of one page. */
  aspect: number;
  /** Intrinsic size of page 1 in PDF points, for metadata display. */
  baseWidthPt: number;
  baseHeightPt: number;
}

export interface ReaderSettings {
  layout: LayoutMode;
  spreadMode: SpreadMode;
  /** Fade the toolbar out while reading. */
  autoHideToolbar: boolean;
  /** Bookmarks / page thumbnails panel on the left. */
  showThumbnails: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  layout: 'auto',
  spreadMode: 'book',
  autoHideToolbar: true,
  showThumbnails: false,
};