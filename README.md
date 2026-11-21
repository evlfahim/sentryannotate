# SentryAnnotate

A modular, desktop-first screenshot annotation toolkit built with **Electron**, **TypeScript**, and **Sharp**. Capture your screen, draw arrows and boxes, blur sensitive regions, add numbered steps and text, then copy to clipboard or save as PNG.

Designed from the start to be convertible into a browser extension via a thin adapter layer.

---

## Features

| Feature | Description |
| --- | --- |
| **Screen Capture** | Capture the primary display via Electron's `desktopCapturer` API |
| **Rectangle Tool** | Draw stroked rectangles to highlight areas |
| **Arrow Tool** | Draw arrows with arrowheads between two points |
| **Blur Tool** | Gaussian-blur sensitive regions (backgrounds, faces, text) |
| **Text Tool** | Add free-form text annotations |
| **Numbered Steps** | Place numbered circles for step-by-step guides |
| **Copy to Clipboard** | `Ctrl+C` / `Cmd+C` — copy the annotated screenshot |
| **Save as PNG** | `Ctrl+S` / `Cmd+S` — save to a temp file |
| **Undo / Redo** | `Ctrl+Z` / `Ctrl+Shift+Z` — full annotation history |
| **Dark / Light Mode** | Toggle the toolbar theme |
| **Keyboard Shortcuts** | `V` Select · `R` Box · `A` Arrow · `B` Blur · `T` Text · `S` Step · `Esc` Deselect |
| **Modular Architecture** | `@sentry/core` (image processing) and `@sentry/ui` (HTML overlay) are separate packages |
| **Plugin Adapter** | Drop-in pattern to convert the desktop app into a browser extension |

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | [Electron](https://www.electronjs.org/) v28 |
| Language | [TypeScript](https://www.typescriptlang.org/) v5 |
| Image Processing | [Sharp](https://sharp.pixelplumbing.com/) (libvips) |
| Testing | [Vitest](https://vitest.dev/) v1 |
| Linting | [ESLint](https://eslint.org/) v8 |
| Canvas | HTML5 Canvas (renderer) + off-screen pixel buffers (core) |

---

## Project Structure

```
├── packages/
│   ├── core/                 # @sentry/core – image processing & annotation engine
│   │   ├── src/
│   │   │   ├── CoreCanvas.ts   # Drawing commands, render pipeline, undo/redo
│   │   │   ├── OffscreenSurface.ts  # Raw pixel buffer + Sharp blur (worker threads)
│   │   │   └── index.ts        # Public re-exports
│   │   └── package.json
│   └── ui/                   # @sentry/ui – HTML overlay class
│       ├── src/
│       │   ├── AnnotationUI.ts # Tool buttons, mouse/keyboard handling
│       │   └── index.ts
│       └── package.json
├── src/
│   ├── main.ts               # Electron main process (window, IPC, capture)
│   ├── preload.ts            # Preload script (not shown — bridges IPC)
│   └── ui/
│       └── index.html        # Inlined renderer UI (toolbar + canvas)
├── test/
│   ├── CoreCanvas.test.ts    # 29 unit tests for CoreCanvas
│   └── OffscreenBlur.test.ts # 12 tests for offscreen blur performance
├── vitest.config.ts          # Vitest config with path aliases
├── tsconfig.json             # Root TypeScript config
├── tsconfig.app.json         # App compilation config
├── package.json              # Workspace root
└── README.md
```

### Package separation

- **`@sentry/core`** — Pure TypeScript. No DOM, no Electron. Handles all image decoding, blur, vector overlay compositing, and state management. Can be imported as an npm package.
- **`@sentry/ui`** — Browser-only. Creates the HTML overlay, handles mouse/keyboard events, and calls back into the core.

---

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd sentryannotate

# Install dependencies
npm install

# Verify the build pipeline
npm run build
npm test
```

### Prerequisites

- **Node.js** ≥ 18 (the project targets Node 22)
- **npm** ≥ 9
- A system that supports Sharp's native dependencies (libvips). On Ubuntu/Debian:

```bash
sudo apt-get install -y libvips-dev
```

On macOS with Homebrew:

```bash
brew install vips
```

---

## Running

```bash
# Start the Electron app (full desktop screenshot tool)
npm start
```

This opens a full-screen overlay on your primary display. Click the **Capture Screen** button (top-left camera icon) to take a screenshot, then use the toolbar to annotate.

### Development

```bash
# Watch mode for tests
npm run test:watch

# Lint the source
npm run lint

# Lint and auto-fix
npm run lint:fix
```

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `V` | Select tool |
| `R` | Rectangle tool |
| `A` | Arrow tool |
| `B` | Blur tool |
| `T` | Text tool |
| `S` | Numbered Step tool |
| `Esc` | Deselect / switch to Select |
| `Ctrl+C` / `Cmd+C` | Copy annotated screenshot to clipboard |
| `Ctrl+S` / `Cmd+S` | Save annotated screenshot as PNG |
| `Ctrl+Z` | Undo last annotation |
| `Ctrl+Shift+Z` | Redo |

---

## How It Works

### Render Pipeline

1. **Capture** — Electron's `desktopCapturer` grabs the primary display as a PNG buffer.
2. **Decode** — `OffscreenSurface.fromImage()` decodes the PNG into raw RGBA pixels via Sharp (once, cached).
3. **Blur** — Each blur region is extracted from the raw buffer and processed by Sharp's `blur()` on a libuv worker thread. Blurred rows are copied back into the surface.
4. **Composite** — All vector overlays (boxes, arrows, text, steps) are rendered as SVG strings and composited in a single Sharp pipeline pass.
5. **Encode** — The final image is encoded to PNG exactly once.

This means a 4K screenshot with 5 blur regions and 10 annotations only triggers **one** PNG encode and **one** decode, rather than the 30+ that a naive approach would require.

### Undo / Redo

Every drawing operation (`drawBox`, `drawArrow`, `applyBlur`, `drawText`, `addStep`) pushes a snapshot of the annotation list onto an undo stack. Undo/redo simply swaps the current state with the previous/next snapshot — no re-drawing needed.

---

## Converting to a Browser Extension

SentryAnnotate was designed to be convertible into a browser extension with minimal changes. The key idea is the **plugin adapter** pattern: replace the Electron-specific APIs with their browser equivalents while keeping `@sentry/core` and `@sentry/ui` untouched.

### Step 1: Replace screen capture

**Desktop (Electron):**
```ts
// src/main.ts — IPC handler
ipcMain.handle('capture-screen', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 3840, height: 2160 },
  });
  const screenSource = sources.find(s => s.id.startsWith('screen')) || sources[0];
  const pngBuffer = screenSource.thumbnail.toPNG();
  return { success: true, width: pngBuffer.width, height: pngBuffer.height, png: pngBuffer.toString('base64') };
});
```

**Browser (Chrome Extension):**
```ts
// adapter.ts — browser equivalent
async function captureScreen() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) throw new Error('No active tab');
  const image = await chrome.tabs.captureVisibleTab(chrome.windows.getCurrent().id, { format: 'png' });
  // image is a data URL like "data:image/png;base64,iVBOR..."
  const response = await fetch(image);
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const metadata = await sharp(Buffer.from(buffer)).metadata();
  return { success: true, width: metadata.width, height: metadata.height, png: image.split(',')[1] };
}
```

### Step 2: Replace clipboard

**Desktop:**
```ts
import { clipboard } from 'electron';
clipboard.writeBuffer('png', buffer);
```

**Browser:**
```ts
// adapter.ts — browser equivalent
async function copyToClipboard(buffer: ArrayBuffer) {
  const blob = new Blob([buffer], { type: 'image/png' });
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob })
  ]);
}
```

### Step 3: Replace file save

**Desktop:**
```ts
import * as fs from 'fs';
fs.writeFileSync(filename, buffer);
```

**Browser:**
```ts
// adapter.ts — browser equivalent
function saveAsPng(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

### Step 4: Create the adapter

Create an `adapter.ts` that exports the three functions above with a unified interface:

```ts
// adapter.ts
import type { CoreCanvas } from '@sentry/core';

export interface ScreenshotAdapter {
  captureScreen(): Promise<{ success: boolean; width: number; height: number; png: string }>;
  copyToClipboard(buffer: ArrayBuffer): Promise<void>;
  saveAsPng(buffer: ArrayBuffer, filename: string): void;
}

// Export the Electron or browser implementation based on the build target.
// Use a bundler (Webpack, Rollup) with conditional exports or a build flag.
```

### Step 5: Build for the browser

Replace the Electron main process with a service worker or content script, and bundle `@sentry/core` + `@sentry/ui` + `adapter.ts` with your preferred bundler. The core canvas logic needs no changes — it's pure TypeScript.

### What stays the same

- `@sentry/core` — all drawing, blur, render, and undo/redo logic
- `@sentry/ui` — the HTML overlay with toolbar, mouse handling, and keyboard shortcuts
- The annotation data model (`Box`, `Arrow`, `BlurRegion`, `TextAnnotation`, `StepAnnotation`)

### What changes

| Electron API | Browser Replacement |
| --- | --- |
| `desktopCapturer.getSources()` | `chrome.tabs.captureVisibleTab()` |
| `clipboard.writeBuffer()` | `navigator.clipboard.write()` |
| `fs.writeFileSync()` | `<a download>` blob download |
| `ipcMain.handle()` | `chrome.runtime.sendMessage()` / content script |
| `BrowserWindow` | Content script injected into active tab |

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

The test suite covers:

- **CoreCanvas** (29 tests): box, arrow, blur, text, step drawing; render output; undo/redo; state management; clipboard buffer; annotation getters.
- **OffscreenBlur** (12 tests): blur region extraction, sigma clamping, multi-region blur, no main-thread blocking (event loop gap < 250ms on 1920×1080 with 5 blur regions), edge clamping, empty region handling.

Tests use the OS temp directory for any temporary files and clean up after themselves.

---

## License

MIT
