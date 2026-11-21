/**
 * AnnotationUI – the HTML overlay for tool selection, coordinate mapping,
 * and keyboard shortcut handling.
 *
 * This module renders an HTML overlay on top of the captured screenshot
 * and maps mouse events to CoreCanvas drawing operations.
 *
 * Runs in the Electron renderer process (browser context).
 */

import type { Annotation, Point } from '@sentry/core';

export type ToolType = 'select' | 'box' | 'arrow' | 'blur' | 'text' | 'step' | 'pan';

export interface AnnotationUIOptions {
  /** Width of the canvas area. */
  width: number;
  /** Height of the canvas area. */
  height: number;
  /** Base64-encoded PNG background image (null if none). */
  background?: string | null;
  /** Callback when the user clicks "Save". */
  onSave?: (pngBuffer: ArrayBuffer) => void;
  /** Callback when the user clicks "Copy". */
  onCopy?: (pngBuffer: ArrayBuffer) => void;
  /** Callback when the user clicks "Undo". */
  onUndo?: () => void;
  /** Callback when the user clicks "Redo". */
  onRedo?: () => void;
  /** Callback when the user clicks "Clear". */
  onClear?: () => void;
  /** Callback when annotations change. */
  onAnnotationsChange?: (annotations: Annotation[]) => void;
}

export class AnnotationUI {
  private overlay: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tool: ToolType = 'select';
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private annotations: Annotation[] = [];
  private onSave?: (pngBuffer: ArrayBuffer) => void;
  private onCopy?: (pngBuffer: ArrayBuffer) => void;
  private onUndo?: () => void;
  private onRedo?: () => void;
  private onClear?: () => void;
  private onAnnotationsChange?: (annotations: Annotation[]) => void;
  private stepCounter = 0;
  private darkMode = false;

  constructor(options: AnnotationUIOptions) {
    this.onSave = options.onSave;
    this.onCopy = options.onCopy;
    this.onUndo = options.onUndo;
    this.onRedo = options.onRedo;
    this.onClear = options.onClear;
    this.onAnnotationsChange = options.onAnnotationsChange;

    this.canvas = document.createElement('canvas');
    this.canvas.width = options.width;
    this.canvas.height = options.height;
    this.ctx = this.canvas.getContext('2d')!;

    this.overlay = this.createOverlay();
  }

  /** Attach the overlay to the given container element. */
  attachTo(container: HTMLElement): void {
    container.appendChild(this.overlay);
    this.bindEvents();
  }

  /** Remove the overlay from the DOM. */
  detach(): void {
    this.unbindEvents();
    if (this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
  }

  /** Set the current drawing tool. */
  setTool(tool: ToolType): void {
    this.tool = tool;
    this.updateToolbar();
  }

  /** Get the current tool. */
  getTool(): ToolType {
    return this.tool;
  }

  /** Toggle dark mode. */
  toggleDarkMode(): void {
    this.darkMode = !this.darkMode;
    this.overlay.classList.toggle('dark', this.darkMode);
  }

  /** Get dark mode state. */
  isDarkMode(): boolean {
    return this.darkMode;
  }

  /** Set annotations from the core canvas. */
  setAnnotations(annotations: Annotation[]): void {
    this.annotations = [...annotations];
    this.redraw();
  }

  /** Get current annotations. */
  getAnnotations(): Annotation[] {
    return [...this.annotations];
  }

  /** Add an annotation. */
  addAnnotation(ann: Annotation): void {
    this.annotations.push(ann);
    this.redraw();
    this.onAnnotationsChange?.(this.annotations);
  }

  /** Remove all annotations. */
  clearAnnotations(): void {
    this.annotations = [];
    this.redraw();
    this.onAnnotationsChange?.([]);
  }

  // ── Overlay creation ──────────────────────────────────────

  private createOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.className = 'sa-overlay';
    overlay.innerHTML = `
      <div class="sa-toolbar">
        <button class="sa-tool" data-tool="select" title="Select (V)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
          </svg>
        </button>
        <button class="sa-tool" data-tool="box" title="Rectangle (R)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
          </svg>
        </button>
        <button class="sa-tool" data-tool="arrow" title="Arrow (A)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
        <button class="sa-tool" data-tool="blur" title="Blur (B)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
          </svg>
        </button>
        <button class="sa-tool" data-tool="text" title="Text (T)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
          </svg>
        </button>
        <button class="sa-tool" data-tool="step" title="Numbered Step (S)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="currentColor" stroke="none" font-size="12">1</text>
          </svg>
        </button>
        <div class="sa-separator"></div>
        <button class="sa-action" id="sa-undo" title="Undo (Ctrl+Z)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
        </button>
        <button class="sa-action" id="sa-redo" title="Redo (Ctrl+Shift+Z)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>
          </svg>
        </button>
        <button class="sa-action" id="sa-clear" title="Clear All">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
        <div class="sa-separator"></div>
        <button class="sa-action sa-export" id="sa-copy" title="Copy to Clipboard (Ctrl+C)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
        <button class="sa-action sa-export" id="sa-save" title="Save as PNG (Ctrl+S)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        <div class="sa-separator"></div>
        <button class="sa-action" id="sa-theme" title="Toggle Dark/Light Mode">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
          </svg>
        </button>
      </div>
      <div class="sa-canvas-container">
        <canvas class="sa-canvas"></canvas>
      </div>
    `;
    return overlay;
  }

  // ── Event binding ─────────────────────────────────────────

  private bindEvents(): void {
    // Tool buttons
    this.overlay.querySelectorAll('.sa-tool').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setTool(btn.getAttribute('data-tool') as ToolType);
      });
    });

    // Action buttons
    const undoBtn = this.overlay.querySelector('#sa-undo') as HTMLButtonElement;
    const redoBtn = this.overlay.querySelector('#sa-redo') as HTMLButtonElement;
    const clearBtn = this.overlay.querySelector('#sa-clear') as HTMLButtonElement;
    const copyBtn = this.overlay.querySelector('#sa-copy') as HTMLButtonElement;
    const saveBtn = this.overlay.querySelector('#sa-save') as HTMLButtonElement;
    const themeBtn = this.overlay.querySelector('#sa-theme') as HTMLButtonElement;

    undoBtn?.addEventListener('click', () => this.onUndo?.());
    redoBtn?.addEventListener('click', () => this.onRedo?.());
    clearBtn?.addEventListener('click', () => this.onClear?.());
    copyBtn?.addEventListener('click', () => this.handleCopy());
    saveBtn?.addEventListener('click', () => this.handleSave());
    themeBtn?.addEventListener('click', () => this.toggleDarkMode());

    // Mouse events on canvas
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('mouseleave', (e) => this.onMouseUp(e));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  private unbindEvents(): void {
    document.removeEventListener('keydown', this.onKeyDown);
  }

  // ── Mouse handlers ────────────────────────────────────────

  private getCanvasPoint(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private onMouseDown(e: MouseEvent): void {
    if (this.tool === 'select' || this.tool === 'pan') return;

    const { x, y } = this.getCanvasPoint(e);
    this.isDrawing = true;
    this.startX = x;
    this.startY = y;

    if (this.tool === 'text') {
      const text = prompt('Enter text:');
      if (text) {
        this.addAnnotation({ type: 'text', x, y, text, color: '#ffffff', fontSize: 16 });
      }
      this.isDrawing = false;
      return;
    }

    if (this.tool === 'step') {
      this.stepCounter++;
      this.addAnnotation({ type: 'step', x, y, number: this.stepCounter, color: '#ffffff', fontSize: 16 });
      this.isDrawing = false;
      return;
    }

    if (this.tool === 'blur') {
      this.addAnnotation({ type: 'blur', x, y, width: 100, height: 100, radius: 8 });
      this.isDrawing = false;
      return;
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isDrawing) return;
    // Preview drawing would go here with a temporary overlay
  }

  private onMouseUp(e: MouseEvent): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    const { x, y } = this.getCanvasPoint(e);

    if (this.tool === 'box') {
      const minX = Math.min(this.startX, x);
      const minY = Math.min(this.startY, y);
      const width = Math.abs(x - this.startX);
      const height = Math.abs(y - this.startY);
      if (width > 5 && height > 5) {
        this.addAnnotation({ type: 'box', x: minX, y: minY, width, height, color: '#ff0000', lineWidth: 2 });
      }
    }

    if (this.tool === 'arrow') {
      const dx = x - this.startX;
      const dy = y - this.startY;
      if (Math.sqrt(dx * dx + dy * dy) > 10) {
        this.addAnnotation({ type: 'arrow', from: { x: this.startX, y: this.startY }, to: { x, y }, color: '#ff0000', lineWidth: 2 });
      }
    }

    this.redraw();
  }

  // ── Keyboard shortcuts ────────────────────────────────────

  private onKeyDown = (e: KeyboardEvent): void => {
    // Ctrl+C – copy
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
      e.preventDefault();
      this.handleCopy();
      return;
    }

    // Ctrl+S – save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      this.handleSave();
      return;
    }

    // Ctrl+Z – undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.onUndo?.();
      return;
    }

    // Ctrl+Shift+Z – redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'Z') {
      e.preventDefault();
      this.onRedo?.();
      return;
    }

    // Esc – deselect / cancel
    if (e.key === 'Escape') {
      this.setTool('select');
      return;
    }

    // Single-letter shortcuts
    switch (e.key.toLowerCase()) {
      case 'v': this.setTool('select'); break;
      case 'r': this.setTool('box'); break;
      case 'a': this.setTool('arrow'); break;
      case 'b': this.setTool('blur'); break;
      case 't': this.setTool('text'); break;
      case 's': if (!e.ctrlKey && !e.metaKey) this.setTool('step'); break;
    }
  };

  // ── Actions ───────────────────────────────────────────────

  private async handleCopy(): Promise<void> {
    const dataUrl = this.canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    if (base64) {
      const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
      this.onCopy?.(buffer);
    }
  }

  private async handleSave(): Promise<void> {
    const dataUrl = this.canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    if (base64) {
      const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
      this.onSave?.(buffer);
    }
  }

  // ── Rendering ─────────────────────────────────────────────

  private redraw(): void {
    const ctx = this.ctx;
    const { width, height } = this.canvas;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw background
    if (this.overlay.querySelector('.sa-canvas')?.getAttribute('data-background')) {
      const bgImg = new Image();
      bgImg.onload = () => {
        ctx.drawImage(bgImg, 0, 0, width, height);
        this.drawAnnotations();
      };
      bgImg.src = this.overlay.querySelector('.sa-canvas')?.getAttribute('data-background') || '';
    }

    this.drawAnnotations();
  }

  private drawAnnotations(): void {
    const ctx = this.ctx;

    for (const ann of this.annotations) {
      switch (ann.type) {
        case 'box':
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = ann.lineWidth;
          ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
          break;

        case 'arrow':
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = ann.lineWidth;
          ctx.beginPath();
          ctx.moveTo(ann.from.x, ann.from.y);
          ctx.lineTo(ann.to.x, ann.to.y);
          ctx.stroke();
          // Arrowhead
          const angle = Math.atan2(ann.to.y - ann.from.y, ann.to.x - ann.from.x);
          const headLen = 12 + ann.lineWidth * 2;
          ctx.beginPath();
          ctx.moveTo(ann.to.x, ann.to.y);
          ctx.lineTo(
            ann.to.x - headLen * Math.cos(angle - Math.PI / 6),
            ann.to.y - headLen * Math.sin(angle - Math.PI / 6),
          );
          ctx.moveTo(ann.to.x, ann.to.y);
          ctx.lineTo(
            ann.to.x - headLen * Math.cos(angle + Math.PI / 6),
            ann.to.y - headLen * Math.sin(angle + Math.PI / 6),
          );
          ctx.stroke();
          break;

        case 'blur':
          // Draw a semi-transparent overlay for blur regions
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
          ctx.setLineDash([]);
          break;

        case 'text':
          ctx.fillStyle = ann.color;
          ctx.font = `${ann.fontSize}px sans-serif`;
          ctx.fillText(ann.text, ann.x, ann.y);
          break;

        case 'step': {
          const radius = 12;
          const cx = ann.x;
          const cy = ann.y;
          ctx.fillStyle = '#e53e3e';
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${ann.fontSize - 2}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(ann.number), cx, cy);
          ctx.textAlign = 'start';
          ctx.textBaseline = 'alphabetic';
          break;
        }
      }
    }
  }

  /** Set the background image (base64 PNG). */
  setBackground(base64: string): void {
    this.canvas.setAttribute('data-background', base64);
    this.redraw();
  }

  private updateToolbar(): void {
    this.overlay.querySelectorAll('.sa-tool').forEach((btn) => {
      const isActive = btn.getAttribute('data-tool') === this.tool;
      btn.classList.toggle('active', isActive);
    });
  }
}
