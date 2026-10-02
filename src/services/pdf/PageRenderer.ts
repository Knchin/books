import { clamp } from '../../utils/clamp';
import { ByteLruCache } from '../../utils/lru';
import type { RenderTarget, RenderedPage } from '../../types/pdf';
import { AnnotationMode, RenderingCancelledException } from './worker';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from './worker';
import { ReaderError } from './errors';

interface Job {
  pageNumber: number;
  priority: number;
  cancelled: boolean;
  running: boolean;
  /**
   * Identity of this attempt. A page can be abandoned and re-queued while its
   * previous render is still unwinding, so every completion has to be able to
   * answer "am I still the job for this page?" before it writes anything.
   */
  token: object;
  run: () => Promise<void>;
}

/** Lower runs first. Visible pages get a large negative bonus. */
export const PRIORITY = {
  visible: -1000,
  adjacent: 0,
  prefetch: 500,
  far: 4000,
} as const;

/** Re-render thresholds, expressed relative to the ideal scale. */
const MIN_FRESHNESS = 0.78;
const MAX_FRESHNESS = 1.7;

export interface PageRendererOptions {
  label: string;
  budgetBytes: number;
  concurrency: number;
  maxCanvasDimension: number;
  renderAnnotations: boolean;
  /** Multiplier on the render scale, used to render thumbnails smaller. */
  scaleMultiplier?: number;
}

/**
 * Renders PDF pages to canvases on demand, newest-wins, under a hard byte
 * budget.
 *
 * Design notes:
 *  - One instance per "quality lane" (screen pages, thumbnails). Lanes never
 *    share a queue, so opening the thumbnail panel can never starve the page
 *    the reader is looking at.
 *  - Every cached entry remembers the page's natural size in points, so the
 *    "is this bitmap still sharp enough?" test is a pure arithmetic check - no
 *    extra `getPage()` round trip and no guesswork.
 *  - Rasterising happens inside the PDF.js worker. The main thread only ever
 *    receives finished bitmaps, which is what lets the flip animation hold 60fps
 *    while pages are still rendering.
 */
export class PageRenderer {
  private readonly cache: ByteLruCache<number, RenderedPage>;

  private readonly jobs = new Map<number, Job>();

  private readonly listeners = new Map<number, Set<() => void>>();

  private readonly failures = new Map<number, ReaderError>();

  private readonly runningRenders = new Map<object, RenderTask>();

  private target: RenderTarget = { width: 800, height: 1100, pixelRatio: 1 };

  private doc: PDFDocumentProxy;

  private destroyed = false;

  private activeCount = 0;

  constructor(
    doc: PDFDocumentProxy,
    private readonly options: PageRendererOptions,
  ) {
    this.doc = doc;
    this.cache = new ByteLruCache<number, RenderedPage>(
      options.budgetBytes,
      (entry) => entry.bytes,
      (pageNumber) => {
        this.failures.delete(pageNumber);
        this.notify(pageNumber);
      },
    );
  }

  /**
   * Swap in a new document.
   *
   * The controller constructs its renderers before a document exists so the
   * instance shape never changes while the reader is mounted; the real document
   * is attached in `open()`.
   */
  setDocument(doc: PDFDocumentProxy): void {
    this.doc = doc;
    this.clear();
  }

  getTarget(): RenderTarget {
    return this.target;
  }

  get numPages(): number {
    return this.doc.numPages;
  }

  get bytes(): number {
    return this.cache.bytes;
  }

  get budgetBytes(): number {
    return this.cache.budget;
  }

  get queuedCount(): number {
    return this.jobs.size;
  }

  get busy(): boolean {
    return this.activeCount > 0 || this.jobs.size > 0;
  }

  setBudget(bytes: number): void {
    this.cache.setBudget(bytes);
  }

  setTarget(target: RenderTarget): void {
    this.target = target;
  }

  /** Cached render, if any. Does not promote the LRU order. */
  peek(pageNumber: number): RenderedPage | undefined {
    return this.cache.peek(pageNumber);
  }

  get(pageNumber: number): RenderedPage | undefined {
    return this.cache.get(pageNumber);
  }

  failure(pageNumber: number): ReaderError | undefined {
    return this.failures.get(pageNumber);
  }

  touch(pageNumber: number): void {
    this.cache.touch(pageNumber);
  }

  /**
   * Request a page. `priority` is lower-is-sooner; re-requesting a queued page
   * promotes it instead of duplicating the work.
   */
  request(pageNumber: number, priority: number = PRIORITY.adjacent): void {
    if (this.destroyed) return;
    if (pageNumber < 1 || pageNumber > this.doc.numPages) return;

    const existing = this.jobs.get(pageNumber);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      this.pump();
      return;
    }

    const cached = this.cache.peek(pageNumber);
    if (cached && this.isFresh(cached)) return;
    if (this.failures.has(pageNumber)) return;

    const token = {};
    const job: Job = {
      pageNumber,
      priority,
      cancelled: false,
      running: false,
      token,
      run: () => this.renderInto(pageNumber, token),
    };
    this.jobs.set(pageNumber, job);
    this.pump();
  }

  /**
   * Recompute priorities for in-flight work.
   *
   * `score` returns a lower-is-sooner priority, or `null` to abandon the job.
   * Abandoning is what stops a fast scrub through an 800 page document from
   * queueing hundreds of renders nobody wants any more.
   */
  reprioritize(score: (pageNumber: number) => number | null): void {
    if (this.destroyed) return;
    for (const job of Array.from(this.jobs.values())) {
      const next = score(job.pageNumber);
      if (next === null) {
        this.abandon(job);
      } else if (next < job.priority) {
        job.priority = next;
      }
    }
    this.pump();
  }

  /** Drop all queued and running work, keeping finished bitmaps. */
  clearQueue(): void {
    for (const job of Array.from(this.jobs.values())) this.abandon(job);
  }

  /** Drop queued work *and* cached bitmaps. */
  clear(): void {
    this.clearQueue();
    this.cache.clear();
    this.failures.clear();
  }

  /** Let a failed page be attempted again (e.g. after a resize). */
  retry(pageNumber: number): void {
    this.failures.delete(pageNumber);
    this.notify(pageNumber);
  }

  subscribe(pageNumber: number, listener: () => void): () => void {
    let set = this.listeners.get(pageNumber);
    if (!set) {
      set = new Set();
      this.listeners.set(pageNumber, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.listeners.delete(pageNumber);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearQueue();
    this.cache.clear();
    this.listeners.clear();
    this.failures.clear();
  }

  // ---------------------------------------------------------------- internals

  /** Device pixels per PDF point needed to fill the target box with this page. */
  private scaleFor(naturalWidth: number, naturalHeight: number): number {
    const { width, height, pixelRatio } = this.target;
    const fit = Math.min(width / naturalWidth, height / naturalHeight);
    const raw = fit * pixelRatio * (this.options.scaleMultiplier ?? 1);
    const maxDim = this.options.maxCanvasDimension;
    const naturalMax = Math.max(naturalWidth, naturalHeight);
    const capped = naturalMax * raw > maxDim ? maxDim / naturalMax : raw;
    return clamp(capped, 0.05, 32);
  }

  private isFresh(entry: RenderedPage): boolean {
    const required = this.scaleFor(entry.naturalWidth, entry.naturalHeight);
    return entry.scale >= required * MIN_FRESHNESS && entry.scale <= required * MAX_FRESHNESS;
  }

  /**
   * True only while this attempt is still the live job for the page.
   *
   * This is the guard that makes newest-wins safe: an abandoned render that
   * finishes late must not overwrite the newer bitmap, delete the newer job, or
   * decrement a slot that now belongs to someone else.
   */
  private isCurrent(pageNumber: number, token: object): boolean {
    if (this.destroyed) return false;
    const job = this.jobs.get(pageNumber);
    return job !== undefined && !job.cancelled && job.token === token;
  }

  private async renderInto(pageNumber: number, token: object): Promise<void> {
    let page: PDFPageProxy | null = null;
    try {
      page = await this.doc.getPage(pageNumber);
      if (!this.isCurrent(pageNumber, token)) return;

      const natural = page.getViewport({ scale: 1 });
      const scale = this.scaleFor(natural.width, natural.height);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));

      const context = canvas.getContext('2d', { alpha: false });
      if (!context) {
        throw new ReaderError(
          'render-failed',
          `Page ${pageNumber} could not be drawn.`,
          'The browser refused to provide a 2D drawing surface.',
        );
      }
      // Paper is opaque. Without this the page composites over the book texture.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        intent: 'display',
        annotationMode: this.options.renderAnnotations
          ? AnnotationMode.ENABLE
          : AnnotationMode.DISABLE,
        background: '#ffffff',
      });
      this.runningRenders.set(token, renderTask);
      await renderTask.promise;

      if (!this.isCurrent(pageNumber, token)) return;

      const previous = this.cache.peek(pageNumber);
      const entry: RenderedPage = {
        pageNumber,
        canvas,
        scale,
        naturalWidth: natural.width,
        naturalHeight: natural.height,
        bytes: canvas.width * canvas.height * 4,
        lastUsed: this.cache.tick(),
        revision: (previous?.revision ?? 0) + 1,
      };
      this.cache.set(pageNumber, entry);
      this.failures.delete(pageNumber);
      this.notify(pageNumber);
    } catch (error) {
      if (this.isCancellation(error)) return;
      // A cancelled or superseded attempt must not leave a failure behind for
      // the job that replaced it.
      if (!this.isCurrent(pageNumber, token)) return;
      const failure =
        error instanceof ReaderError
          ? error
          : new ReaderError(
              'render-failed',
              `Page ${pageNumber} could not be displayed.`,
              'This page may use a feature your browser cannot draw.',
              { cause: error },
            );
      this.failures.set(pageNumber, failure);
      this.notify(pageNumber);
    } finally {
      this.runningRenders.delete(token);
      // Hand the page's parsed content back to the GC. PDF.js defers internally
      // if the page is somehow still in use, so this is always safe to call.
      try {
        page?.cleanup();
      } catch {
        /* the document may have been closed underneath us */
      }
      this.activeCount -= 1;
      // Only retire the map entry if it is still ours: a newer job for the same
      // page must survive this completion.
      if (this.jobs.get(pageNumber)?.token === token) this.jobs.delete(pageNumber);
      this.pump();
    }
  }

  private abandon(job: Job): void {
    job.cancelled = true;
    if (job.running) {
      try {
        this.runningRenders.get(job.token)?.cancel();
      } catch {
        /* the task may already have settled */
      }
    }
    this.jobs.delete(job.pageNumber);
  }

  private isCancellation(error: unknown): boolean {
    if (error instanceof RenderingCancelledException) return true;
    if (typeof error !== 'object' || error === null) return false;
    const name = (error as { name?: string }).name;
    return name === 'RenderingCancelledException' || name === 'AbortException';
  }

  private pump(): void {
    if (this.destroyed) return;

    const pending = Array.from(this.jobs.values())
      .filter((job) => !job.cancelled && !job.running)
      .sort((a, b) => a.priority - b.priority || a.pageNumber - b.pageNumber);

    for (const job of pending) {
      if (this.activeCount >= this.options.concurrency) break;
      if (job.cancelled) continue;
      // It may have become fresh while queued (a resize can bump the cache up
      // to date behind our back); drop it rather than waste a raster.
      const cached = this.cache.peek(job.pageNumber);
      if (cached && this.isFresh(cached)) {
        this.jobs.delete(job.pageNumber);
        continue;
      }
      job.running = true;
      this.activeCount += 1;
      void job.run();
    }
  }

  private notify(pageNumber: number): void {
    const set = this.listeners.get(pageNumber);
    if (!set) return;
    for (const listener of Array.from(set)) listener();
  }
}