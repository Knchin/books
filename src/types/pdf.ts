/** A page that has been rasterised into an offscreen canvas. */
export interface RenderedPage {
  pageNumber: number;
  /** Rasterised page. Never attached to the DOM directly; surfaces blit from it. */
  canvas: HTMLCanvasElement;
  /** Device pixels per PDF point at which `canvas` was produced. */
  scale: number;
  /** Page size in points (already normalised for page rotation). */
  naturalWidth: number;
  naturalHeight: number;
  /** Approximate heap cost of the canvas backing store. */
  bytes: number;
  /** Monotonic timestamp of last use, for LRU eviction. */
  lastUsed: number;
  /** Bumped on every re-render so surfaces know to repaint. */
  revision: number;
}

/** Where a page should be rendered at (CSS pixels). */
export interface RenderTarget {
  width: number;
  height: number;
  pixelRatio: number;
}

export type PageRenderState = 'idle' | 'queued' | 'rendering' | 'ready' | 'error';

export interface DocumentInfo {
  title: string;
  author: string | null;
  numPages: number;
  /** True when the source document has a non-zero uniform page rotation. */
  hasRotation: boolean;
  fingerprint: string | null;
}

export type PasswordReason = 'need-password' | 'incorrect-password';

export interface PasswordRequest {
  reason: PasswordReason;
  submit: (password: string) => void;
  cancel: () => void;
}

/** Progress of the File -> ArrayBuffer read step. */
export interface FileReadProgress {
  loaded: number;
  total: number;
  /** 0..1, or null when the size is unknown. */
  ratio: number | null;
}