# Realistic PDF Book Reader

Read any PDF as a physical book: click or drag a page to turn it, pair pages two
up, zoom and pan a spread, and flip through a thumbnail strip. Everything runs
in the browser — the file you pick is never uploaded, and the app works offline
once loaded.

## Why it is built this way

The hard part of a PDF reader is not parsing; it is performance. A 400-page
document at reading size is far more pixel work than a browser wants to do in
one frame, and a naive implementation drops frames, leaks canvases, and holds
whole documents in memory.

So the reader is built around a few ideas:

- **Rendering is scheduled, never blocking.** Each page render is a job with a
  byte budget, served from an LRU cache, prioritised so the pages on screen and
  the pages being turned into come first and prefetched pages come last.
- **Animation never goes through React.** Page turns are driven by CSS custom
  properties (`--fp`, `--fa`, `--fl`, `--flip-active`) written imperatively from
  a Web Animations timeline. React re-renders only when the settled spread
  changes, so a 3D turn costs no reconciliation.
- **Page bitmaps are disposed.** Canvases are released as soon as they scroll out
  of the live set, and the whole document is torn down on close.

## Features

- Cover-aware page pairing in book and consecutive-pairs modes, with a
  single-page mode for phones and for one-page documents.
- Click-to-turn, edge peel, drag-to-turn with velocity flick, keyboard
  navigation, and a page-number jump box.
- Zoom to 400%, pan, pinch-to-zoom, double-tap zoom, and wheel zoom.
- Lazy thumbnail strip that rasterises only what is near the viewport and jumps
  to any page.
- Local file loading with streaming progress, encrypted-PDF prompting, and
  readable errors for the things that actually go wrong.
- Respects `prefers-reduced-motion`: turns become instant page changes.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `←` / `Page Up` | Previous page |
| `→` / `Page Down` / `Space` | Next page |
| `Home` / `End` | First / last page |
| `+` / `-` | Zoom in / out |
| `0` | Reset zoom to fit |
| `f` | Toggle fullscreen |
| `t` | Toggle thumbnails |
| `Esc` | Close a dialog or popover |

## Development

```bash
npm install
npm run dev       # dev server
npm run typecheck # tsc -b
npm run build     # typecheck + production build into dist/
npm run preview   # serve the production build
```

The build uses a relative base path, so `dist/` can be served from any static
host or subdirectory.

## Deployment

`.github/workflows/deploy.yml` publishes `main` to GitHub Pages: it typechecks,
builds, uploads `dist/` as a Pages artifact, and deploys it with the official
Pages actions. Enable **Settings → Pages → Source → GitHub Actions** once in the
repository settings.

## Privacy

No network requests carry your document. The PDF is read with the File API,
parsed by `pdfjs-dist` in a worker, and rasterised into canvases on the device.
There is no backend, no analytics, and no storage of any kind.

## License

MIT