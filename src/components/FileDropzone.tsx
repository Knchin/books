import { useCallback, useEffect, useRef, useState } from 'react';
import { BookIcon } from './Icons';
import { ACCEPT_ATTRIBUTE, ACCEPT_LABEL } from '../services/pdf/fileLoader';

export interface FileDropzoneProps {
  onFile: (file: File) => void;
  busy?: boolean;
  compact?: boolean;
}

/**
 * The document picker.
 *
 * A real `<input type="file">` is the primary control - it is the only way to
 * open a document from the keyboard, and it is what makes the button genuinely
 * a button. Drag and drop is layered on top of it, because it is a shortcut, not
 * a replacement.
 */
export function FileDropzone({ onFile, busy = false, compact = false }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  // Depth counter: `dragenter`/`dragleave` fire for every child element, so a
  // boolean flickers as the pointer crosses the zone's internal borders.
  const depthRef = useRef(0);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      const file = list?.[0];
      if (!file) return;
      onFile(file);
    },
    [onFile],
  );

  useEffect(() => {
    const onDragOverWindow = (event: DragEvent) => {
      // Without this the browser navigates away when a file is dropped outside
      // the zone, losing the reader's entire session.
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'none';
    };
    const onDropWindow = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener('dragover', onDragOverWindow);
    window.addEventListener('drop', onDropWindow);
    return () => {
      window.removeEventListener('dragover', onDragOverWindow);
      window.removeEventListener('drop', onDropWindow);
    };
  }, []);

  const onZoneDragEnter = (event: React.DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    depthRef.current += 1;
    setDragging(true);
  };

  const onZoneDragOver = (event: React.DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const onZoneDragLeave = (event: React.DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setDragging(false);
  };

  const onZoneDrop = (event: React.DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    depthRef.current = 0;
    setDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(event.target.files);
    // Clearing the value lets the same file be re-picked after an error.
    event.target.value = '';
  };

  return (
    <div
      className="dropzone"
      data-compact={compact ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-busy={busy ? 'true' : 'false'}
      data-no-gesture="true"
      onDragEnter={onZoneDragEnter}
      onDragOver={onZoneDragOver}
      onDragLeave={onZoneDragLeave}
      onDrop={onZoneDrop}
    >
      {compact ? null : (
        <div className="dropzone__art" aria-hidden="true">
          <BookIcon width={40} height={40} />
        </div>
      )}

      <div className="dropzone__copy">
        <p className="dropzone__headline">
          {compact ? 'Drop a PDF here' : 'Drop a PDF to open it'}
        </p>
        <p className="dropzone__hint">
          or <span className="dropzone__browse">browse your files</span> &middot; {ACCEPT_LABEL}
        </p>
      </div>

      <button
        type="button"
        className="button button--primary dropzone__button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        Choose a PDF
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="visually-hidden"
        onChange={onInputChange}
        tabIndex={-1}
        aria-hidden="true"
        // Announced separately so screen readers hear "choose a PDF" without
        // also hearing the file dialog's own label twice.
      />
      <p className="visually-hidden" role="status">
        Nothing is uploaded. The file is read in this browser tab only.
      </p>
    </div>
  );
}

function hasFiles(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  return Array.from(transfer.types ?? []).includes('Files');
}

export function DropOverlay() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let depth = 0;
    const onEnter = (event: DragEvent) => {
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes('Files')) return;
      depth += 1;
      setActive(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const onDrop = () => {
      depth = 0;
      setActive(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div className="drop-overlay" data-active={active ? 'true' : 'false'} aria-hidden="true">
      <div className="drop-overlay__card">
        <BookIcon width={30} height={30} />
        <p>Drop to open</p>
      </div>
    </div>
  );
}