import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookReader, MAX_ZOOM, ZOOM_STEP } from './components/BookReader/BookReader';
import { DropOverlay, FileDropzone } from './components/FileDropzone';
import { ErrorNotice } from './components/ErrorNotice';
import { LoadingScreen } from './components/LoadingScreen';
import { PasswordPrompt } from './components/PasswordPrompt';
import { ThumbnailPanel } from './components/ThumbnailPanel';
import { Toolbar } from './components/Toolbar/Toolbar';
import { computeBookLayout, useElementSize } from './hooks/useBookLayout';
import { useFlipEngine } from './hooks/useFlipEngine';
import { useAutoHideChrome } from './hooks/useAutoHideChrome';
import { useFullscreen } from './hooks/useFullscreen';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { usePrefersReducedMotion } from './hooks/useMediaQuery';
import { clamp } from './utils/clamp';
import { PdfBookController } from './services/pdf/PdfBookController';
import type { OpenPhase } from './services/pdf/PdfBookController';
import { describeSpread, spreadIndexForPage, spreadPages } from './services/pdf/spreads';
import { ReaderError, toReaderError } from './services/pdf/errors';
import type { DocumentInfo, PasswordRequest, RenderTarget } from './types/pdf';
import type {
  BookGeometry,
  LayoutMode,
  PageNumber,
  ReaderSettings,
  Spread,
  SpreadMode,
} from './types/book';
import { DEFAULT_SETTINGS } from './types/book';

/** Width a thumbnail is rasterised at, in CSS pixels. */
const THUMBNAIL_WIDTH = 132;

/**
 * Preview of the geometry used before a document exists, so the start screen can
 * draw a book with the same proportions a real one will have.
 */
const PLACEHOLDER_ASPECT = 1 / Math.SQRT2;

const PLACEHOLDER_GEOMETRY: BookGeometry = {
  aspect: PLACEHOLDER_ASPECT,
  baseWidthPt: 595,
  baseHeightPt: 842,
};

/**
 * The reader.
 *
 * `App` owns exactly two pieces of state worth naming:
 *
 *  1. Which document is open - held by a ref, because a `PdfBookController` is a
 *     resource manager with worker handles, not a value. React renders what it
 *     was told; the ref is what actually holds the bytes.
 *  2. The current turn - held by the flip engine, which is driven imperatively
 *     during an animation and read through one subscription.
 *
 * Everything else - zoom, layout mode, toolbar visibility - is small enough to
 * be plain React state, because none of it changes at animation rate.
 */
export function App() {
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [zoom, setZoom] = useState(1);

  const [fileName, setFileName] = useState('');
  const [openPhase, setOpenPhase] = useState<OpenPhase | null>(null);
  const [error, setError] = useState<ReaderError | null>(null);
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null);

  const [info, setInfo] = useState<DocumentInfo | null>(null);
  const [geometry, setGeometry] = useState<BookGeometry>(PLACEHOLDER_GEOMETRY);
  const [spreads, setSpreads] = useState<Spread[]>([]);
  const [spreadIndex, setSpreadIndex] = useState(0);

  // `version` exists only to re-render after an imperative mutation of the
  // controller's spread list, which is owned by the service, not by React.
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const controllerRef = useRef<PdfBookController | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageHostRef = useRef<HTMLDivElement | null>(null);

  const reducedMotion = usePrefersReducedMotion();
  const fullscreen = useFullscreen(rootRef.current);

  const documentOpen = controllerRef.current !== null && spreads.length > 0;

  // ------------------------------------------------------------- responsive

  const hostSize = useElementSize(stageHostRef);
  const layout = useMemo(
    () =>
      computeBookLayout({
        availableWidth: hostSize.width,
        availableHeight: hostSize.height,
        aspect: geometry.aspect,
        layout: settings.layout,
        // A short, wide viewport is a phone on its side; a spread there is
        // unreadable even though it technically fits.
        compactHeight: hostSize.height > 0 && hostSize.height < hostSize.width * 0.55,
      }),
    [geometry.aspect, hostSize.height, hostSize.width, settings.layout],
  );


  // ------------------------------------------------------------- flip engine

  const engine = useFlipEngine({
    spreadCount: spreads.length,
    reducedMotion,
    onIndexChange: (index) => {
      setSpreadIndex(index);
      controllerRef.current?.setCurrentSpread(index);
    },
    onTurnRequested: (fromIndex, toIndex) => {
      controllerRef.current?.prime(controllerRef.current.pagesForTurn(fromIndex, toIndex));
    },
  });

  // ---------------------------------------------------------------- opening

  const closeDocument = useCallback(() => {
    const controller = controllerRef.current;
    controllerRef.current = null;
    if (controller) controller.dispose();
    setSpreads([]);
    setInfo(null);
    setGeometry(PLACEHOLDER_GEOMETRY);
    setSpreadIndex(0);
    setPasswordRequest(null);
    setError(null);
    setZoom(1);
    setSettings((previous) =>
      previous.showThumbnails ? { ...previous, showThumbnails: false } : previous,
    );
    setFileName('');
    setOpenPhase(null);
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      // One document at a time, strictly: the previous controller is disposed
      // before a new one exists, so no worker or bitmap can outlive its file.
      closeDocument();
      setFileName(file.name);
      setError(null);
      setOpenPhase({ kind: 'reading', ratio: 0, loaded: 0, total: file.size });

      const controller = new PdfBookController(settings.spreadMode, layout.viewMode);
      controllerRef.current = controller;
      controller.onGeometryChange = (next) => setGeometry(next);

      try {
        const result = await controller.open(file, {
          onPhase: (phase) => setOpenPhase(phase),
          onPassword: (request) => setPasswordRequest(request),
        });

        setInfo(result.info);
        setGeometry(result.geometry);
        setSpreads(controller.allSpreads);
        setSpreadIndex(0);
        setOpenPhase(null);
        bump();
      } catch (caught) {
        const readerError = toReaderError(caught);
        // A cancelled password prompt is a choice, not a failure worth showing.
        if (readerError.code === 'cancelled') {
          setOpenPhase(null);
          setFileName('');
          closeDocument();
          return;
        }
        controllerRef.current = null;
        controller.dispose();
        setOpenPhase(null);
        setError(readerError);
      }
    },
    [closeDocument, layout.viewMode, settings.spreadMode],
  );

  // Tear the controller down if the app itself unmounts.
  useEffect(() => closeDocument, [closeDocument]);

  // ----------------------------------------------------------- render target

  /**
   * Rasterise at the size the book is actually displayed at, plus a pixel-ratio
   * headroom factor. Above 1.5 the cached bitmap is still reused and a sharper
   * one is fetched in the background, so zooming in never blanks a page.
   */
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || layout.pageWidth < 2) return;

    const target: RenderTarget = {
      width: layout.pageWidth,
      height: layout.pageHeight,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2) * (zoom > 1.5 ? 1.6 : 1),
    };
    controller.setRenderTarget(target);
    controller.setThumbnailTarget({
      width: THUMBNAIL_WIDTH,
      height: Math.round(THUMBNAIL_WIDTH / geometry.aspect),
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    });
  }, [geometry.aspect, layout.pageHeight, layout.pageWidth, spreadIndex, zoom]);

  /**
   * Adopt a rebuilt spread list from the controller.
   *
   * Rebuilding the list changes how many spreads there are and where the current
   * one sits, so the flip engine, the controller and the toolbar all have to move
   * together - otherwise the book renders one spread while the page indicator
   * reports another. `immediate` because there is no physical position to
   * animate from: the page on screen is simply different now.
   */
  const syncSpreads = useCallback(
    (controller: PdfBookController) => {
      const next = controller.allSpreads;
      setSpreads(next);
      setSpreadIndex(controller.currentIndex);
      engine.adoptSpreads(next.length, controller.currentIndex);
      bump();
    },
    [bump, engine],
  );

  // Keep the controller's pairing in step with the resolved view mode. Single
  // page view has one spread per page, so the spread list must be rebuilt when
  // the effective view mode changes - not just when the preference changes.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (controller.getViewMode() !== layout.viewMode) {
      controller.setViewMode(layout.viewMode);
      syncSpreads(controller);
    }
  }, [layout.viewMode, syncSpreads]);

  // Prime every page the current frame needs as soon as the list settles.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setCurrentSpread(spreadIndex);
    controller.prime(spreadPages(spreads[spreadIndex]));
  }, [spreadIndex, spreads]);

  // ------------------------------------------------------------------ chrome

  const chrome = useAutoHideChrome({
    enabled: settings.autoHideToolbar && documentOpen,
    pinned: passwordRequest !== null || settings.showThumbnails,
  });

  const goToPage = useCallback(
    (page: PageNumber) => {
      const total = info?.numPages ?? spreads.length;
      const index = spreadIndexForPage(spreads, clamp(page, 1, total));
      engine.goTo(index);
      chrome.wake();
    },
    [chrome, engine, info, spreads],
  );

  const changeZoom = useCallback((next: number) => {
    setZoom(clamp(next, 1, MAX_ZOOM));
  }, []);

  const settingsHandlers = {
    onLayoutChange: (next: LayoutMode) => {
      setSettings((previous) => ({ ...previous, layout: next }));
      // Zoom is relative to "fits the page", which just changed underneath us.
      setZoom(1);
    },
    onSpreadModeChange: (next: SpreadMode) => {
      setSettings((previous) => ({ ...previous, spreadMode: next }));
      const controller = controllerRef.current;
      if (!controller) return;
      controller.setSpreadMode(next);
      syncSpreads(controller);
    },
    onAutoHideChange: (next: boolean) => {
      setSettings((previous) => ({ ...previous, autoHideToolbar: next }));
    },
  };

  const toggleThumbnails = useCallback(() => {
    setSettings((previous) => ({ ...previous, showThumbnails: !previous.showThumbnails }));
    chrome.wake();
  }, [chrome]);

  useGlobalShortcuts({
    enabled: documentOpen,
    suspended: passwordRequest !== null,
    onNext: () => {
      engine.next();
      chrome.wake();
    },
    onPrevious: () => {
      engine.previous();
      chrome.wake();
    },
    onFirst: () => engine.goTo(0),
    onLast: () => engine.goTo(spreads.length - 1),
    onZoomIn: () => changeZoom(zoom + ZOOM_STEP),
    onZoomOut: () => changeZoom(zoom - ZOOM_STEP),
    onZoomReset: () => changeZoom(1),
    onToggleThumbnails: toggleThumbnails,
    onToggleFullscreen: () => {
      void fullscreen.toggle();
    },
    onClose: closeDocument,
  });

  // ------------------------------------------------------------------ render

  const currentSpread = spreads[spreadIndex];
  const visiblePages = spreadPages(currentSpread);
  const firstPage = visiblePages[0] ?? 1;
  const secondPage = visiblePages.length > 1 ? visiblePages[1] : null;

  return (
    <div className="app" ref={rootRef} data-fullscreen={fullscreen.isFullscreen ? 'true' : 'false'}>
      <DropOverlay />

      {/*
        The body is its own row so the thumbnail panel sits beside the stage
        instead of above it. The toolbar is deliberately *not* here: it is
        absolutely positioned so fading it out never reflows the book.
      */}
      <div className="app__body">
      {documentOpen ? (
        <>
          <ThumbnailPanel
            pages={info?.numPages ?? spreads.length}
            currentPage={firstPage}
            aspectRatio={geometry.aspect}
            width={THUMBNAIL_WIDTH}
            renderer={controllerRef.current?.thumbnails ?? null}
            doc={controllerRef.current?.document ?? null}
            visible={settings.showThumbnails}
            onSelect={goToPage}
            onClose={toggleThumbnails}
          />


          <Toolbar
            visible={chrome.visible}
            title={info?.title ?? fileName}
            page={firstPage}
            secondPage={secondPage}
            totalPages={info?.numPages ?? 1}
            atStart={engine.atStart}
            atEnd={engine.atEnd}
            zoom={zoom}
            minZoom={1}
            maxZoom={MAX_ZOOM}
            layout={settings.layout}
            spreadMode={settings.spreadMode}
            autoHideToolbar={settings.autoHideToolbar}
            showThumbnails={settings.showThumbnails}
            isFullscreen={fullscreen.isFullscreen}
            fullscreenSupported={fullscreen.isSupported}
            onNext={() => {
              engine.next();
              chrome.wake();
            }}
            onPrevious={() => {
              engine.previous();
              chrome.wake();
            }}
            onGoToPage={goToPage}
            onZoomIn={() => changeZoom(zoom + ZOOM_STEP)}
            onZoomOut={() => changeZoom(zoom - ZOOM_STEP)}
            onZoomReset={() => changeZoom(1)}
            onToggleFullscreen={() => {
              void fullscreen.toggle();
            }}
            onToggleThumbnails={toggleThumbnails}
            onLayoutChange={settingsHandlers.onLayoutChange}
            onSpreadModeChange={settingsHandlers.onSpreadModeChange}
            onAutoHideChange={settingsHandlers.onAutoHideChange}
            onCloseDocument={closeDocument}
            onOpenAnother={closeDocument}
          />
        </>
      ) : null}

      {/*
        One host element for both screens, on purpose: the resize observer
        measures this node, and swapping the node would leave it measuring a
        detached element. It also means the stage is never unmounted and
        remounted, so no gesture listener or scroll position is lost on open.
      */}
      <main className="stage-host" ref={stageHostRef}>
        {documentOpen ? (
          <BookReader
            spreads={spreads}
            engine={engine}
            renderer={controllerRef.current?.pages ?? null}
            doc={controllerRef.current?.document ?? null}
            layout={layout}
            viewMode={layout.viewMode}
            zoom={zoom}
            reducedMotion={reducedMotion}
            onZoomChange={changeZoom}
            onUserGesture={chrome.wake}
          />
        ) : (
          <div className="start">
            <div className="start__inner">
              <p className="start__eyebrow">Local PDF book reader</p>
              <h1 className="start__title">Read a PDF like a book</h1>
              <p className="start__lead">
                Realistic page turns, drag or swipe to flip, zoom, and a thumbnail
                index of every page. Your file is read in this browser tab and
                never uploaded anywhere.
              </p>

              <FileDropzone onFile={(file) => void openFile(file)} />

              <dl className="start__keys">
                <div>
                  <dt>
                    <kbd>&larr;</kbd> <kbd>&rarr;</kbd>
                  </dt>
                  <dd>Turn pages</dd>
                </div>
                <div>
                  <dt>
                    <kbd>Space</kbd>
                  </dt>
                  <dd>Next page</dd>
                </div>
                <div>
                  <dt>
                    <kbd>Ctrl</kbd> + <kbd>+</kbd>
                  </dt>
                  <dd>Zoom</dd>
                </div>
                <div>
                  <dt>
                    <kbd>F</kbd>
                  </dt>
                  <dd>Thumbnails</dd>
                </div>
                <div>
                  <dt>
                    <kbd>Esc</kbd>
                  </dt>
                  <dd>Close</dd>
                </div>
              </dl>
            </div>
          </div>
        )}
      </main>
      </div>

      {openPhase ? <LoadingScreen phase={openPhase} fileName={fileName} /> : null}

      {passwordRequest ? (
        <PasswordPrompt request={passwordRequest} fileName={fileName} />
      ) : null}

      {error && !documentOpen ? (
        <ErrorNotice
          error={error}
          onChooseAnother={closeDocument}
          onRetry={error.code === 'file-read-failed' ? closeDocument : undefined}
        />
      ) : null}

      <p className="visually-hidden" role="status" aria-live="polite">
        {documentOpen
          ? `${describeSpread(currentSpread)}${
              info ? ` of ${info.numPages} pages` : ''
            }`
          : ''}
      </p>
    </div>
  );
}