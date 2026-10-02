import { estimateDeviceMemoryGb } from '../../utils/dom';
import type { DocumentInfo, PasswordRequest, RenderTarget } from '../../types/pdf';
import type {
  BookGeometry,
  PageNumber,
  Spread,
  SpreadMode,
  ViewMode,
} from '../../types/book';
import { readFileBytes } from './fileLoader';
import { PageRenderer, PRIORITY } from './PageRenderer';
import { buildSpreads, spreadPages } from './spreads';
import { ReaderError, toReaderError } from './errors';
import {
  PasswordResponses,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from './worker';

/** How many spreads on either side are kept warm. */
const PREFETCH_SPREADS = 2;
/** Beyond this distance from the current spread, queued renders are abandoned. */
const ABANDON_DISTANCE = 14;
/** How many pages are sampled when guessing the shape of a mixed-size document. */
const GEOMETRY_SAMPLES = 12;

export type OpenPhase =
  | { kind: 'reading'; ratio: number | null; loaded: number; total: number }
  | { kind: 'parsing' }
  | { kind: 'measuring' };

export interface OpenOptions {
  onPassword: (request: PasswordRequest) => void;
  onPhase?: (phase: OpenPhase) => void;
}

export interface OpenResult {
  info: DocumentInfo;
  geometry: BookGeometry;
}

/**
 * Owns one open document: the PDF.js worker, the render queues and the bitmap
 * caches.
 *
 * Deliberately a plain class rather than React state. It is a resource manager
 * with worker handles and byte budgets, none of which belong in a render tree;
 * React subscribes to the two narrow slices it needs (info and geometry).
 *
 * One controller instance corresponds to exactly one document. Opening a second
 * PDF means disposing the controller and building a new one, which is what
 * guarantees no page bitmap or worker from the previous document survives.
 */
/**
 * Placeholder passed to a render lane before a document exists.
 *
 * A renderer only dereferences its document inside `renderInto`, which cannot
 * run before `open()` calls `setDocument` with the real proxy. Keeping the
 * constructor signature honest (a renderer always *has* a document field)
 * avoids a second construction path.
 */
const UNDOCUMENTED = undefined as unknown as PDFDocumentProxy;

export class PdfBookController {
  /** Screen-resolution page lane. */
  readonly pages: PageRenderer;

  /** Low-resolution lane for the thumbnail panel. */
  readonly thumbnails: PageRenderer;

  private loadingTask: PDFDocumentLoadingTask | null = null;

  private doc: PDFDocumentProxy | null = null;

  private currentSpreadIndex = 0;

  private spreadMode: SpreadMode = 'book';

  private viewMode: ViewMode = 'spread';

  private spreads: Spread[] = [];

  private geometry: BookGeometry = {
    aspect: 1 / Math.SQRT2,
    baseWidthPt: 595,
    baseHeightPt: 842,
  };

  private disposed = false;

  private measuring = false;

  private passwordRequest: PasswordRequest | null = null;


  /** Notifies the UI when a late measurement corrects the book shape. */
  onGeometryChange: ((geometry: BookGeometry) => void) | null = null;

  constructor(spreadMode: SpreadMode = 'book', viewMode: ViewMode = 'spread') {
    this.spreadMode = spreadMode;
    this.viewMode = viewMode;

    const memoryGb = estimateDeviceMemoryGb();
    // Budget = a fraction of the memory the device advertises, so a 2 GB phone
    // is never asked to hold a quarter gigabyte of canvas.
    const pageBudgetMb = Math.min(288, Math.max(64, memoryGb * 48));
    const thumbBudgetMb = Math.min(72, Math.max(20, memoryGb * 10));
    const cores = navigator.hardwareConcurrency || 4;

    this.pages = new PageRenderer(UNDOCUMENTED, {
      label: 'pages',
      budgetBytes: Math.round(pageBudgetMb * 1024 * 1024),
      concurrency: cores >= 8 ? 3 : 2,
      maxCanvasDimension: 4096,
      renderAnnotations: true,
    });

    this.thumbnails = new PageRenderer(UNDOCUMENTED, {
      label: 'thumbnails',
      budgetBytes: Math.round(thumbBudgetMb * 1024 * 1024),
      concurrency: 2,
      maxCanvasDimension: 320,
      renderAnnotations: false,
      scaleMultiplier: 0.55,
    });
  }

  // --------------------------------------------------------------- lifecycle

  /**
   * Read and open a PDF from disk.
   *
   * Bytes are read locally through the File API and parsed inside the PDF.js
   * worker. Nothing is uploaded and nothing is persisted.
   */
  async open(file: File, options: OpenOptions): Promise<OpenResult> {
    if (this.disposed) {
      throw new ReaderError('cancelled', 'This reader has already been closed.');
    }

    const { bytes } = await readFileBytes(file, (progress) => {
      options.onPhase?.({
        kind: 'reading',
        ratio: progress.ratio,
        loaded: progress.loaded,
        total: progress.total,
      });
    });

    if (this.disposed) {
      throw new ReaderError('cancelled', 'The document was closed.');
    }

    options.onPhase?.({ kind: 'parsing' });

    let cancelledByUser = false;
    const loadingTask = getDocument({
      data: bytes,
      // No network is available to a local reader, so never try to fetch the
      // rest of a document we already hold in memory.
      disableAutoFetch: true,
      // Keep font handling local: PDF.js would otherwise look for the standard
      // fonts next to the app.
      useSystemFonts: true,
      stopAtErrors: false,
    });
    // The loading task is retained for the document's whole lifetime: it owns
    // the worker, and `destroy()` is the only correct way to shut it down.
    this.loadingTask = loadingTask;

    loadingTask.onPassword = (
      updatePassword: (password: string) => void,
      reason: number,
    ) => {
      this.passwordRequest = {
        reason:
          reason === PasswordResponses.INCORRECT_PASSWORD
            ? 'incorrect-password'
            : 'need-password',
        submit: (password: string) => updatePassword(password),
        cancel: () => {
          cancelledByUser = true;
          this.passwordRequest = null;
          void loadingTask.destroy();
        },
      };
      options.onPassword(this.passwordRequest);
    };

    let doc: PDFDocumentProxy;
    try {
      doc = await loadingTask.promise;
    } catch (error) {
      this.loadingTask = null;
      this.passwordRequest = null;
      if (cancelledByUser || this.disposed) {
        throw new ReaderError('cancelled', 'Opening the document was cancelled.');
      }
      throw toReaderError(error);
    }

    this.passwordRequest = null;

    if (this.disposed) {
      void loadingTask.destroy();
      throw new ReaderError('cancelled', 'The document was closed.');
    }

    if (doc.numPages < 1) {
      void loadingTask.destroy();
      this.loadingTask = null;
      throw new ReaderError(
        'corrupt',
        'This PDF does not contain any pages.',
        'The file may be damaged, or it may contain only embedded attachments.',
      );
    }

    this.doc = doc;
    this.pages.setDocument(doc);
    this.thumbnails.setDocument(doc);

    this.geometry = await this.measureGeometry(doc);
    options.onPhase?.({ kind: 'measuring' });

    const info = await this.readInfo(doc);

    this.rebuildSpreads();
    this.setCurrentSpread(0);

    // Warm the neighbourhood in the background; the first spread is already
    // queued by `setCurrentSpread` and the cover can paint immediately.
    void this.refineGeometryInBackground(doc);

    return { info, geometry: this.geometry };
  }

  /** Release the worker, the queues and every cached bitmap. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.measuring = false;
    this.pages.destroy();
    this.thumbnails.destroy();
    this.passwordRequest = null;
    this.doc = null;
    this.spreads = [];
    this.currentSpreadIndex = 0;
    const task = this.loadingTask;
    this.loadingTask = null;
    void task?.destroy().catch(() => undefined);
  }

  // ------------------------------------------------------------------ getters

  get document(): PDFDocumentProxy | null {
    return this.doc;
  }

  get numPages(): number {
    return this.doc?.numPages ?? 0;
  }

  get allSpreads(): Spread[] {
    return this.spreads;
  }

  get spreadCount(): number {
    return this.spreads.length;
  }

  get currentIndex(): number {
    return this.currentSpreadIndex;
  }

  get bookGeometry(): BookGeometry {
    return this.geometry;
  }

  get passwordPrompt(): PasswordRequest | null {
    return this.passwordRequest;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  // ------------------------------------------------------------------ methods

  /**
   * Change how pages are paired, keeping the reader on the same printed page.
   *
   * Pairing only means something in two-page view; single-page view has one
   * spread per page, so the pairing setting is remembered but not applied.
   */
  setSpreadMode(mode: SpreadMode): void {
    if (this.spreadMode === mode) return;
    this.spreadMode = mode;
    if (this.viewMode === 'spread') this.rebuildSpreads();
  }

  getSpreadMode(): SpreadMode {
    return this.spreadMode;
  }

  /**
   * Switch between one page and a facing spread.
   *
   * The spread list is rebuilt because the two modes genuinely have different
   * page-to-slot mappings: a book-mode spread {2,3} has no meaning when only one
   * page is on screen.
   */
  setViewMode(mode: ViewMode): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.rebuildSpreads();
  }

  getViewMode(): ViewMode {
    return this.viewMode;
  }

  /** Where the reader should rasterise, in CSS pixels plus a DPR multiplier. */
  setRenderTarget(target: RenderTarget): void {
    this.pages.setTarget(target);
    this.pages.clearQueue();
    this.pages.reprioritize((pageNumber) => this.priorityFor(pageNumber));
  }

  setThumbnailTarget(target: RenderTarget): void {
    this.thumbnails.setTarget(target);
    this.thumbnails.clearQueue();
  }

  /** Move the reading position and re-plan every render priority. */
  setCurrentSpread(index: number): void {
    if (this.spreads.length === 0) return;
    const clamped = Math.max(0, Math.min(this.spreads.length - 1, index));
    this.currentSpreadIndex = clamped;
    this.pages.reprioritize((pageNumber) => this.priorityFor(pageNumber));
    this.warmNeighbourhood(clamped);
  }

  /** Every page a turn touches, so nothing is revealed empty mid-animation. */
  pagesForTurn(fromIndex: number, toIndex: number): PageNumber[] {
    const set = new Set<PageNumber>();
    for (const index of [fromIndex, toIndex]) {
      for (const page of spreadPages(this.spreads[index])) set.add(page);
    }
    return Array.from(set);
  }

  /** Raise a specific set of pages to the front of the queue. */
  prime(pages: PageNumber[]): void {
    for (const page of pages) this.pages.request(page, PRIORITY.visible);
  }

  // ---------------------------------------------------------------- internals

  private rebuildSpreads(): void {
    const anchor = this.spreads[this.currentSpreadIndex];
    const anchorPage = anchor?.left ?? anchor?.right ?? 1;

    this.spreads = buildSpreads(this.numPages, this.spreadMode, this.viewMode);

    let next = 0;
    for (let i = 0; i < this.spreads.length; i += 1) {
      if (spreadPages(this.spreads[i]).includes(anchorPage)) {
        next = i;
        break;
      }
    }
    this.currentSpreadIndex = next;
  }

  private priorityFor(pageNumber: number): number | null {
    const distance = this.distanceFromCurrent(pageNumber);
    if (distance === null) return null;
    if (distance <= 1) return PRIORITY.visible;
    if (distance <= PREFETCH_SPREADS) return PRIORITY.adjacent + distance * 10;
    if (distance > ABANDON_DISTANCE) return null;
    return PRIORITY.prefetch + distance * 10;
  }

  /** Distance in spreads between `pageNumber` and the current spread. */
  private distanceFromCurrent(pageNumber: number): number | null {
    if (this.spreads.length === 0) return null;
    let best = Number.POSITIVE_INFINITY;
    // `distanceFromCurrent` is called for every queued page, so it stops as
    // soon as it can no longer beat the best distance found so far.
    for (let i = this.currentSpreadIndex; i < this.spreads.length; i += 1) {
      const distance = i - this.currentSpreadIndex;
      if (distance >= best) break;
      if (spreadPages(this.spreads[i]).includes(pageNumber)) best = distance;
    }
    for (let i = this.currentSpreadIndex - 1; i >= 0; i -= 1) {
      const distance = this.currentSpreadIndex - i;
      if (distance >= best) break;
      if (spreadPages(this.spreads[i]).includes(pageNumber)) best = distance;
    }
    return Number.isFinite(best) ? best : null;
  }

  private warmNeighbourhood(index: number): void {
    const start = Math.max(0, index - PREFETCH_SPREADS);
    const end = Math.min(this.spreads.length - 1, index + PREFETCH_SPREADS);
    for (let i = start; i <= end; i += 1) {
      const distance = Math.abs(i - index);
      const priority = distance === 0 ? PRIORITY.visible : PRIORITY.adjacent + distance * 10;
      for (const page of spreadPages(this.spreads[i])) {
        this.pages.request(page, priority);
      }
    }
  }

  private async readInfo(doc: PDFDocumentProxy): Promise<DocumentInfo> {
    let title = '';
    let author: string | null = null;
    let fingerprint: string | null = null;
    try {
      const { info } = await doc.getMetadata();
      const dict = info as Record<string, unknown> | undefined;
      title = typeof dict?.Title === 'string' ? dict.Title.trim() : '';
      author = typeof dict?.Author === 'string' && dict.Author ? dict.Author.trim() : null;
      fingerprint = doc.fingerprints?.[0] ?? null;
    } catch {
      // A damaged info dictionary must never stop a document from opening.
      title = '';
    }

    let hasRotation = false;
    try {
      const page = await doc.getPage(1);
      hasRotation = page.rotate % 360 !== 0;
    } catch {
      hasRotation = false;
    }

    return { title, author, numPages: doc.numPages, hasRotation, fingerprint };
  }

  /**
   * Read page 1's shape so the book can appear immediately.
   *
   * Only one page is touched. Mixed-orientation documents are corrected by
   * `refineGeometryInBackground` once the book is already on screen.
   */
  private async measureGeometry(doc: PDFDocumentProxy): Promise<BookGeometry> {
    try {
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      page.cleanup();
      return {
        aspect: viewport.width / viewport.height,
        baseWidthPt: viewport.width,
        baseHeightPt: viewport.height,
      };
    } catch {
      return { aspect: 1 / Math.SQRT2, baseWidthPt: 595, baseHeightPt: 842 };
    }
  }

  /**
   * Sample a spread of pages and, if the document is not uniform, grow the page
   * box so nothing is ever clipped. Only ever grows: a smaller box could crop
   * content, and relayout mid-session is a worse trade than a little margin.
   */
  private async refineGeometryInBackground(doc: PDFDocumentProxy): Promise<void> {
    if (this.measuring || this.disposed) return;
    this.measuring = true;
    const total = doc.numPages;

    const indices = new Set<number>([1, total]);
    for (let i = 0; i <= GEOMETRY_SAMPLES; i += 1) {
      indices.add(1 + Math.round((i / GEOMETRY_SAMPLES) * (total - 1)));
    }

    let maxWidth = 0;
    let maxHeight = 0;
    try {
      for (const pageNumber of Array.from(indices)) {
        if (this.disposed || this.doc !== doc) return;
        let page: PDFPageProxy | null = null;
        try {
          page = await doc.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          maxWidth = Math.max(maxWidth, viewport.width);
          maxHeight = Math.max(maxHeight, viewport.height);
        } catch {
          // One unreadable page must not derail the measurement.
        } finally {
          try {
            page?.cleanup();
          } catch {
            /* ignore */
          }
        }
      }
    } finally {
      this.measuring = false;
    }

    if (maxWidth <= 0 || maxHeight <= 0) return;

    const current = this.geometry;
    const nextWidth = Math.max(current.baseWidthPt, maxWidth);
    const nextHeight = Math.max(current.baseHeightPt, maxHeight);
    const nextAspect = nextWidth / nextHeight;
    if (Math.abs(nextAspect - current.aspect) <= 0.004) return;

    this.geometry = {
      aspect: nextAspect,
      baseWidthPt: nextWidth,
      baseHeightPt: nextHeight,
    };
    // Existing bitmaps were rasterised for the old box; ask for the new scale.
    this.pages.setTarget(this.pages.getTarget());
    this.onGeometryChange?.(this.geometry);
  }

}