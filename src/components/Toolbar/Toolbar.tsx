import { useEffect, useRef, useState } from 'react';
import { PageIndicator } from './PageIndicator';
import { SettingsMenu } from './SettingsMenu';
import { ZoomControls } from './ZoomControls';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CollapseIcon,
  ExpandIcon,
  FileIcon,
  GridIcon,
  SettingsIcon,
} from '../Icons';
import type { LayoutMode, SpreadMode } from '../../types/book';

export interface ToolbarProps {
  visible: boolean;
  title: string;
  page: number;
  secondPage: number | null;
  totalPages: number;
  atStart: boolean;
  atEnd: boolean;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  layout: LayoutMode;
  spreadMode: SpreadMode;
  autoHideToolbar: boolean;
  showThumbnails: boolean;
  isFullscreen: boolean;
  fullscreenSupported: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onGoToPage: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onToggleFullscreen: () => void;
  onToggleThumbnails: () => void;
  onLayoutChange: (layout: LayoutMode) => void;
  onSpreadModeChange: (mode: SpreadMode) => void;
  onAutoHideChange: (enabled: boolean) => void;
  onCloseDocument: () => void;
  onOpenAnother: () => void;
}

/**
 * The toolbar.
 *
 * Three rules keep it from competing with the book:
 *  1. It fades out entirely while reading, and any pointer or key activity brings
 *     it straight back.
 *  2. It never hides while something inside it has focus, so a keyboard user can
 *     never lose their place.
 *  3. Nothing here changes the document's state implicitly; every control is an
 *     explicit action the reader took.
 */
export function Toolbar({
  visible,
  title,
  page,
  secondPage,
  totalPages,
  atStart,
  atEnd,
  zoom,
  minZoom,
  maxZoom,
  layout,
  spreadMode,
  autoHideToolbar,
  showThumbnails,
  isFullscreen,
  fullscreenSupported,
  onNext,
  onPrevious,
  onGoToPage,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onToggleFullscreen,
  onToggleThumbnails,
  onLayoutChange,
  onSpreadModeChange,
  onAutoHideChange,
  onCloseDocument,
  onOpenAnother,
}: ToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const hasFocusRef = useRef(false);

  // Never fade the toolbar out while it holds focus: losing it would strand a
  // keyboard user with no visible focus target.
  useEffect(() => {
    const onFocusIn = () => {
      hasFocusRef.current = true;
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget instanceof Node) {
        if ((event.currentTarget as HTMLElement).contains(next)) return;
      }
      hasFocusRef.current = false;
    };
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  // Close the popover if the chrome goes away underneath it.
  useEffect(() => {
    if (autoHideToolbar && !visible) setSettingsOpen(false);
  }, [autoHideToolbar, visible]);

  const closeSettings = () => {
    setSettingsOpen(false);
    // Return focus to the control that opened it.
    settingsButtonRef.current?.focus();
  };

  const onKeyDownInToolbar = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && settingsOpen) {
      event.stopPropagation();
      closeSettings();
    }
  };

  return (
    <div
      className="toolbar"
      data-visible={visible ? 'true' : 'false'}
      data-no-gesture="true"
      role="toolbar"
      aria-label="Reader controls"
      aria-orientation="horizontal"
      data-toolbar="true"
      onKeyDown={onKeyDownInToolbar}
    >
      <div className="toolbar__inner">
        <div className="toolbar__group toolbar__group--start">
          <button
            type="button"
            className="toolbar__file"
            onClick={onOpenAnother}
            title="Open another PDF"
          >
            <FileIcon />
            <span className="toolbar__file-label">Open PDF</span>
          </button>

          <button
            type="button"
            className="icon-button"
            onClick={onToggleThumbnails}
            aria-pressed={showThumbnails}
            aria-label={showThumbnails ? 'Hide page thumbnails' : 'Show page thumbnails'}
            title="Page thumbnails (F)"
          >
            <GridIcon />
          </button>
        </div>

        <p className="toolbar__title" title={title}>
          {title}
        </p>

        <div className="toolbar__group toolbar__group--center">
          <button
            type="button"
            className="icon-button"
            onClick={onPrevious}
            disabled={atStart}
            aria-label="Previous page"
            title="Previous page (Left arrow)"
          >
            <ChevronLeftIcon />
          </button>

          <PageIndicator
            page={page}
            secondPage={secondPage}
            totalPages={totalPages}
            onNavigate={onGoToPage}
          />

          <button
            type="button"
            className="icon-button"
            onClick={onNext}
            disabled={atEnd}
            aria-label="Next page"
            title="Next page (Right arrow)"
          >
            <ChevronRightIcon />
          </button>
        </div>

        <div className="toolbar__group toolbar__group--end">
          <ZoomControls
            zoom={zoom}
            min={minZoom}
            max={maxZoom}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            onZoomReset={onZoomReset}
            disabled={false}
          />

          <div className="divider" aria-hidden="true" />

          {fullscreenSupported ? (
            <button
              type="button"
              className="icon-button"
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
            </button>
          ) : null}

          <div className="toolbar__settings">
            <button
              ref={settingsButtonRef}
              type="button"
              className="icon-button"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              aria-label="Reading settings"
              title="Reading settings"
            >
              <SettingsIcon />
            </button>

            {settingsOpen ? (
              <SettingsMenu
                layout={layout}
                spreadMode={spreadMode}
                autoHideToolbar={autoHideToolbar}
                anchorRef={settingsButtonRef}
                onLayoutChange={onLayoutChange}
                onSpreadModeChange={onSpreadModeChange}
                onAutoHideChange={onAutoHideChange}
                onClose={closeSettings}
              />
            ) : null}
          </div>

          <button
            type="button"
            className="icon-button"
            onClick={onCloseDocument}
            aria-label="Close this PDF and go back to the start screen"
            title="Close PDF (Escape)"
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}