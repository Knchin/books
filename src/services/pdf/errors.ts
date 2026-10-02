import { AbortException, PasswordException } from './worker';

/**
 * A user-facing problem with a stable code, a friendly message and an optional
 * suggested action. Nothing from this module ever leaks a stack trace or a raw
 * PDF.js message into the UI.
 */
export class ReaderError extends Error {
  constructor(
    readonly code: ReaderErrorCode,
    message: string,
    readonly hint?: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'ReaderError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export type ReaderErrorCode =
  | 'not-a-pdf'
  | 'empty-file'
  | 'file-read-failed'
  | 'too-large'
  | 'corrupt'
  | 'password-required'
  | 'wrong-password'
  | 'unsupported'
  | 'render-failed'
  | 'out-of-memory'
  | 'cancelled';

const MAX_FILE_BYTES = 512 * 1024 * 1024;

const ERROR_TITLES: Record<ReaderErrorCode, string> = {
  'not-a-pdf': 'That is not a PDF',
  'empty-file': 'That file is empty',
  'file-read-failed': 'The file could not be read',
  'too-large': 'That file is too large',
  corrupt: 'This PDF is damaged',
  'password-required': 'Password required',
  'wrong-password': 'Incorrect password',
  unsupported: 'This PDF is not supported',
  'render-failed': 'A page could not be displayed',
  'out-of-memory': 'Out of memory',
  cancelled: 'Opening cancelled',
};

/** A short heading for an error, so the UI never shows a bare message. */
export function errorTitle(code: ReaderErrorCode): string {
  return ERROR_TITLES[code];
}

/**
 * Convert any thrown value into a `ReaderError`.
 *
 * PDF.js signals failures with exceptions that carry a `name`; we deliberately
 * match on those names rather than on message text so this keeps working across
 * PDF.js releases.
 */
export function toReaderError(error: unknown): ReaderError {
  if (error instanceof ReaderError) return error;

  if (error instanceof PasswordException) {
    return new ReaderError(
      'password-required',
      'This PDF is password protected.',
      'Enter the password to open the document.',
      { cause: error },
    );
  }

  if (isNamedError(error, 'PasswordException')) {
    return new ReaderError(
      'wrong-password',
      'That password was not accepted.',
      'Check the password and try again.',
      { cause: error },
    );
  }

  if (isNamedError(error, 'InvalidPDFException')) {
    return new ReaderError(
      'corrupt',
      'This file could not be read as a PDF.',
      'The file may be damaged or incompletely downloaded. Try re-exporting or re-downloading it.',
      { cause: error },
    );
  }

  if (isNamedError(error, 'MissingPDFException')) {
    return new ReaderError(
      'corrupt',
      'This file is missing its PDF data.',
      'The download may have been interrupted. Try downloading the file again.',
      { cause: error },
    );
  }

  if (isNamedError(error, 'AbortException')) {
    return new ReaderError('cancelled', 'Loading was cancelled.', undefined, {
      cause: error,
    });
  }

  if (isNamedError(error, 'RenderingCancelledException')) {
    // Cancellation is a normal, expected outcome - never surfaced as a failure.
    return new ReaderError('cancelled', 'Rendering was cancelled.', undefined, {
      cause: error,
    });
  }

  if (isOutOfMemory(error)) {
    return new ReaderError(
      'out-of-memory',
      'This PDF needs more memory than the browser can spare.',
      'Close other tabs, or try again on a device with more memory.',
      { cause: error },
    );
  }

  return new ReaderError(
    'unsupported',
    'This PDF could not be opened.',
    'The reader only supports standard PDF 1.x / 2.x documents.',
    { cause: error },
  );
}

/**
 * The `accept` attribute for the file input, and the human-readable label shown
 * next to the browse link. Kept here because it must agree with the validation
 * below: a picker that filters out a valid PDF is a bug.
 */
export const ACCEPT_ATTRIBUTE = 'application/pdf,.pdf';
export const ACCEPT_LABEL = 'PDF only, up to 512 MB';

/** Validate a dropped/selected file before any bytes are read. */
export function validatePdfFile(file: File): ReaderError | null {
  const nameLooksLikePdf = /\.pdf$/i.test(file.name);
  const typeLooksLikePdf =
    file.type === 'application/pdf' ||
    file.type === 'application/x-pdf' ||
    file.type === 'application/octet-stream' ||
    file.type === '' ||
    file.type === 'application/download';

  if (file.size === 0) {
    return new ReaderError(
      'empty-file',
      'That file is empty.',
      'Choose a PDF that contains at least one page.',
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    return new ReaderError(
      'too-large',
      'That file is too large to open in the browser.',
      `The limit is ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB. Split the document or open it on a larger device.`,
    );
  }

  // Extension and MIME type disagree with each other, or neither looks right.
  // Deliberately permissive about `application/octet-stream` and an empty type,
  // because browsers report those for perfectly valid PDFs; the header check in
  // `readFileBytes` is the authority.
  if (!nameLooksLikePdf && !typeLooksLikePdf) {
    return new ReaderError(
      'not-a-pdf',
      `"${file.name}" is not a PDF file.`,
      'Look for a file ending in .pdf.',
    );
  }

  return null;
}

export { MAX_FILE_BYTES };

function isNamedError(error: unknown, name: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === name
  );
}

function isOutOfMemory(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'RangeError' && /call stack|array length/i.test(error.message)) {
    return true;
  }
  // Safari throws a bare DOMException for allocation failures.
  return (
    (error as { code?: number }).code === 22 ||
    /out of memory|allocation failed|memory limit/i.test(error.message)
  );
}

/**
 * Header sniff: the first bytes of a real PDF are `%PDF-`. Accepting anything
 * else risks handing hostile bytes to the parser, and rejecting a file whose
 * MIME type lied would reject legitimate documents.
 */
export function looksLikePdfBytes(bytes: Uint8Array): boolean {
  // Some producers emit junk before the header; scan the first 1 KB.
  const limit = Math.min(bytes.length - 4, 1024);
  for (let i = 0; i <= limit; i += 1) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 // F
    ) {
      return true;
    }
  }
  return false;
}

export { AbortException };