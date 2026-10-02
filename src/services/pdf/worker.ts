/**
 * Single place where PDF.js is configured.
 *
 * PDF.js v5+ ships ESM only and expects the worker to be provided as a URL.
 * Vite understands the `?url` suffix and will emit the worker as a separate
 * chunk, so the worker is *not* inlined into the main bundle and parsing happens
 * off the main thread.
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const {
  getDocument,
  AnnotationMode,
  PasswordResponses,
  PasswordException,
  InvalidPDFException,
  AbortException,
  RenderingCancelledException,
  version: pdfjsVersion,
  isPdfFile,
} = pdfjs;

export type {
  PDFDocumentProxy,
  PDFPageProxy,
  PDFDocumentLoadingTask,
  PageViewport,
  RenderTask,
} from 'pdfjs-dist';

export default pdfjs;