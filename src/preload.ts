/**
 * Preload script – exposes a safe IPC bridge to the renderer.
 *
 * Maps renderer calls to main-process IPC handlers:
 *  - captureScreen(callback) → 'capture-screen'
 *  - undo() → 'core-undo'
 *  - redo() → 'core-redo'
 *  - clearAnnotations() → 'core-clearAnnotations'
 *  - copyToClipboard(dataUrl) → 'core-copyToClipboard'
 *  - saveAsPng(dataUrl) → 'core-saveAsPng'
 *  - annotationAdded(ann) → 'core-annotationAdded'
 *  - initCanvas(width, height, png) → 'core-init'
 *  - drawBox(...) → 'core-drawBox'
 *  - drawArrow(...) → 'core-drawArrow'
 *  - applyBlur(...) → 'core-applyBlur'
 *  - drawText(...) → 'core-drawText'
 *  - addStep(...) → 'core-addStep'
 *  - render() → 'core-render'
 *  - exportToPng() → 'core-exportToPng'
 */

const { contextBridge, ipcRenderer } = require('electron');

interface CaptureResult {
  success?: boolean;
  width?: number;
  height?: number;
  png?: string;
  error?: string;
}

contextBridge.exposeInMainWorld('electronAPI', {
  captureScreen: (callback: (result: CaptureResult) => void) => {
    ipcRenderer.invoke('capture-screen').then(callback);
  },

  initCanvas: (width: number, height: number, backgroundPng?: string) => {
    return ipcRenderer.invoke('core-init', width, height, backgroundPng);
  },

  drawBox: (x: number, y: number, w: number, h: number, color: string, lineWidth: number) => {
    return ipcRenderer.invoke('core-drawBox', x, y, w, h, color, lineWidth);
  },

  drawArrow: (from: { x: number; y: number }, to: { x: number; y: number }, color: string, lineWidth: number) => {
    return ipcRenderer.invoke('core-drawArrow', from, to, color, lineWidth);
  },

  applyBlur: (x: number, y: number, w: number, h: number, radius: number) => {
    return ipcRenderer.invoke('core-applyBlur', x, y, w, h, radius);
  },

  drawText: (x: number, y: number, text: string, color: string, fontSize: number) => {
    return ipcRenderer.invoke('core-drawText', x, y, text, color, fontSize);
  },

  addStep: (x: number, y: number, number: number, color: string, fontSize: number) => {
    return ipcRenderer.invoke('core-addStep', x, y, number, color, fontSize);
  },

  undo: () => {
    return ipcRenderer.invoke('core-undo');
  },

  redo: () => {
    return ipcRenderer.invoke('core-redo');
  },

  clearAnnotations: () => {
    return ipcRenderer.invoke('core-clearAnnotations');
  },

  annotationAdded: (ann: any) => {
    return ipcRenderer.invoke('core-annotationAdded', ann);
  },

  render: () => {
    return ipcRenderer.invoke('core-render');
  },

  exportToPng: () => {
    return ipcRenderer.invoke('core-exportToPng');
  },

  copyToClipboard: (dataUrl?: string) => {
    return ipcRenderer.invoke('core-copyToClipboard', dataUrl);
  },

  saveAsPng: (dataUrl?: string) => {
    return ipcRenderer.invoke('core-saveAsPng', dataUrl);
  },
});
