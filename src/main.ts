/**
 * Main entry point for the Electron application.
 *
 * Creates the main window, loads the annotation UI, and wires up
 * IPC handlers that connect the renderer's UI to the CoreCanvas core.
 */

import { app, BrowserWindow, screen, clipboard, ipcMain, desktopCapturer } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import { CoreCanvas } from './core/CoreCanvas';

// Disable sandbox when running as root (CI/headless environments)
if (process.getuid && process.getuid() === 0) {
  app.commandLine.appendSwitch('no-sandbox');
}

let mainWindow: BrowserWindow | null = null;
let coreCanvas: CoreCanvas | null = null;

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load the UI HTML
  const htmlPath = path.join(__dirname, '../src/ui/index.html');
  mainWindow.loadFile(htmlPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC Handlers ──────────────────────────────────────────────

ipcMain.handle('core-init', (_event, width: number, height: number, backgroundPng?: string) => {
  const bgBuffer = backgroundPng ? Buffer.from(backgroundPng, 'base64') : undefined;
  coreCanvas = new CoreCanvas(width, height, bgBuffer);
  return { width: coreCanvas.getWidth(), height: coreCanvas.getHeight() };
});

ipcMain.handle('core-drawBox', (_event, x: number, y: number, w: number, h: number, color: string, lineWidth: number) => {
  if (!coreCanvas) return;
  coreCanvas.drawBox(x, y, w, h, color, lineWidth);
});

ipcMain.handle('core-drawArrow', (_event, from: { x: number; y: number }, to: { x: number; y: number }, color: string, lineWidth: number) => {
  if (!coreCanvas) return;
  coreCanvas.drawArrow(from, to, color, lineWidth);
});

ipcMain.handle('core-applyBlur', (_event, x: number, y: number, w: number, h: number, radius: number) => {
  if (!coreCanvas) return;
  coreCanvas.applyBlur(x, y, w, h, radius);
});

ipcMain.handle('core-drawText', (_event, x: number, y: number, text: string, color: string, fontSize: number) => {
  if (!coreCanvas) return;
  coreCanvas.drawText(x, y, text, color, fontSize);
});

ipcMain.handle('core-addStep', (_event, x: number, y: number, number: number, color: string, fontSize: number) => {
  if (!coreCanvas) return;
  coreCanvas.addStep(x, y, number, color, fontSize);
});

ipcMain.handle('core-undo', () => {
  if (!coreCanvas) return false;
  return coreCanvas.undo();
});

ipcMain.handle('core-redo', () => {
  if (!coreCanvas) return false;
  return coreCanvas.redo();
});

ipcMain.handle('core-clearAnnotations', () => {
  if (!coreCanvas) return;
  coreCanvas.clearAnnotations();
});

ipcMain.handle('core-getAnnotations', () => {
  if (!coreCanvas) return [];
  return coreCanvas.getAnnotations();
});

ipcMain.handle('core-render', async () => {
  if (!coreCanvas) return null;
  const buffer = await coreCanvas.render();
  return buffer.toString('base64');
});

ipcMain.handle('core-exportToPng', async () => {
  if (!coreCanvas) return null;
  const ab = await coreCanvas.exportToPng();
  const bytes = new Uint8Array(ab);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
});

ipcMain.handle('core-copyToClipboard', async (_event, dataUrl?: string) => {
  if (!coreCanvas) return;

  // If a dataUrl is provided, decode it and write to clipboard
  if (dataUrl) {
    const base64 = dataUrl.split(',')[1];
    if (base64) {
      const buffer = Buffer.from(base64, 'base64');
      clipboard.writeBuffer('png', buffer);
    }
  } else {
    // Otherwise render and copy from core canvas
    await coreCanvas.copyToClipboard();
    const buf = coreCanvas.getClipboardBuffer();
    if (buf) {
      clipboard.writeBuffer('png', buf);
    }
  }
});

ipcMain.handle('core-saveAsPng', async (_event, dataUrl?: string) => {
  if (!coreCanvas) return false;

  // If a dataUrl is provided, save it directly
  if (dataUrl) {
    const base64 = dataUrl.split(',')[1];
    if (base64) {
      const buffer = Buffer.from(base64, 'base64');
      const tempDir = require('os').tmpdir();
      const filename = path.join(tempDir, 'sentryannotate-' + Date.now() + '.png');
      fs.writeFileSync(filename, buffer);
      return filename;
    }
  }

  // Otherwise render and save from core canvas
  const buffer = await coreCanvas.render();
  const tempDir = require('os').tmpdir();
  const filename = path.join(tempDir, 'sentryannotate-' + Date.now() + '.png');
  fs.writeFileSync(filename, buffer);
  return filename;
});

ipcMain.handle('core-annotationAdded', (_event, ann: any) => {
  // Sync annotation to core canvas
  if (!coreCanvas) return;
  switch (ann.type) {
    case 'box':
      coreCanvas.drawBox(ann.x, ann.y, ann.width, ann.height, ann.color, ann.lineWidth);
      break;
    case 'arrow':
      coreCanvas.drawArrow(ann.from, ann.to, ann.color, ann.lineWidth);
      break;
    case 'blur':
      coreCanvas.applyBlur(ann.x, ann.y, ann.width, ann.height, ann.radius);
      break;
    case 'text':
      coreCanvas.drawText(ann.x, ann.y, ann.text, ann.color, ann.fontSize);
      break;
    case 'step':
      coreCanvas.addStep(ann.x, ann.y, ann.number, ann.color, ann.fontSize);
      break;
  }
});

// ── Screen Capture ──────────────────────────────────────────

/**
 * Captures the screen using Electron's desktopCapturer API.
 * Returns a PNG buffer of the primary display.
 */
ipcMain.handle('capture-screen', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 3840, height: 2160 },
    });

    if (sources.length === 0) {
      return { error: 'No screen sources found' };
    }

    // Use the first screen source
    const screenSource = sources.find(
      (s: any) => s.id.startsWith('screen'),
    ) || sources[0];

    // The thumbnail is a NativeImage — convert to PNG buffer
    const pngBuffer = screenSource.thumbnail.toPNG();

    // Get actual dimensions
    const metadata = await sharp(pngBuffer).metadata();

    return {
      success: true,
      width: metadata.width || 0,
      height: metadata.height || 0,
      png: pngBuffer.toString('base64'),
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
});

app.whenReady().then(createWindow).catch(console.error);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
