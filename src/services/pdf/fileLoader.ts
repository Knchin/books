export { ACCEPT_ATTRIBUTE, ACCEPT_LABEL } from './errors';

import { looksLikePdfBytes, ReaderError, toReaderError, validatePdfFile } from './errors';
import type { FileReadProgress } from '../../types/pdf';

export interface LoadedPdfBytes {
  bytes: Uint8Array;
  fileName: string;
  fileSize: number;
}

/**
 * Read a `File` into a transferable `Uint8Array`.
 *
 * Uses `File.stream()` when available so the UI can show real byte-level
 * progress (matters for a 300 MB scan). The chunks are copied once into a
 * single buffer and released immediately, so peak overhead is one extra copy
 * rather than the whole file held twice for long.
 *
 * The returned buffer is handed to PDF.js, which *transfers* it to the worker
 * thread - the main thread's copy is detached at that moment, which is exactly
 * the behaviour we want for memory.
 */
export async function readFileBytes(
  file: File,
  onProgress?: (progress: FileReadProgress) => void,
): Promise<LoadedPdfBytes> {
  const invalid = validatePdfFile(file);
  if (invalid) throw invalid;

  try {
    const bytes = await streamFile(file, onProgress);

    if (!looksLikePdfBytes(bytes)) {
      throw new ReaderError(
        'not-a-pdf',
        `"${file.name}" is not a PDF file.`,
        'The file contents do not start with a PDF header. Make sure you are not picking a preview or a renamed file.',
      );
    }

    return { bytes, fileName: file.name, fileSize: file.size };
  } catch (error) {
    if (error instanceof ReaderError) throw error;
    throw toReaderError(error);
  }
}

async function streamFile(
  file: File,
  onProgress?: (progress: FileReadProgress) => void,
): Promise<Uint8Array> {
  const total = file.size;
  const supportsStreams = typeof file.stream === 'function';

  if (!supportsStreams) {
    onProgress?.({ loaded: 0, total, ratio: 0 });
    const buffer = await file.arrayBuffer();
    onProgress?.({ loaded: total, total, ratio: 1 });
    return new Uint8Array(buffer);
  }

  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({
        loaded,
        total,
        ratio: total > 0 ? Math.min(1, loaded / total) : null,
      });
    }
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Drop the chunk list before returning so the GC can reclaim it promptly.
  chunks.length = 0;

  onProgress?.({ loaded: total, total, ratio: 1 });
  return out;
}