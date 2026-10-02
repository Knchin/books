import { useCallback, useEffect, useRef } from 'react';
import { isTextEntryFocused } from '../utils/dom';

export interface ShortcutHandlers {
  onNext: () => void;
  onPrevious: () => void;
  onFirst: () => void;
  onLast: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onToggleThumbnails: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export interface UseGlobalShortcutsOptions extends ShortcutHandlers {
  enabled: boolean;
  /** True while a modal owns the keyboard (password prompt, settings). */
  suspended: boolean;
}

const ZOOM_STEP = 0.2;

/**
 * Keyboard navigation.
 *
 * Bound to `window` rather than the book so the reader can be driven without
 * first clicking it, and stood down whenever focus is inside a text field so
 * typing a page number never flips a page.
 */
export function useGlobalShortcuts(options: UseGlobalShortcutsOptions): void {
  const handlersRef = useRef(options);
  handlersRef.current = options;

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    const { enabled, suspended, onClose, onFirst, onLast, onNext, onPrevious } = handlersRef.current;
    if (!enabled || suspended) return;

    // Never steal keys from a text entry. Escape is allowed through so a modal
    // or the page-number field can dismiss itself.
    if (isTextEntryFocused() && event.key !== 'Escape') return;

    const mod = event.metaKey || event.ctrlKey;
    const target = event.target;
    const insideToolbar =
      target instanceof Element && Boolean(target.closest('[data-toolbar]'));

    if (mod) {
      switch (event.key) {
        case '=':
        case '+':
          event.preventDefault();
          handlersRef.current.onZoomIn();
          return;
        case '-':
        case '_':
          event.preventDefault();
          handlersRef.current.onZoomOut();
          return;
        case '0':
          event.preventDefault();
          handlersRef.current.onZoomReset();
          return;
        default:
          return;
      }
    }

    if (event.altKey || event.shiftKey) return;

    switch (event.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        event.preventDefault();
        onNext();
        return;
      case 'ArrowLeft':
      case 'PageUp':
        event.preventDefault();
        onPrevious();
        return;
      case 'Home':
        // Home/End also scroll text fields, so stay out of the way there.
        if (isTextEntryFocused()) return;
        event.preventDefault();
        onFirst();
        return;
      case 'End':
        if (isTextEntryFocused()) return;
        event.preventDefault();
        onLast();
        return;
      case 'Escape':
        if (insideToolbar) return;
        onClose();
        return;
      case 'f':
      case 'F':
        event.preventDefault();
        handlersRef.current.onToggleThumbnails();
        return;
      default:
        return;
    }
  }, []);

  useEffect(() => {
    if (!options.enabled) return;
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown, options.enabled]);
}

export { ZOOM_STEP };