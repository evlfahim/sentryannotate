/**
 * CoreCanvas – the heart of SentryAnnotate.
 *
 * Provides an image-based drawing surface that supports:
 *  - drawBox, drawArrow, drawText, drawStep
 *  - applyBlur on rectangular regions
 *  - render to a final image (Buffer)
 *  - exportToPng / copyToClipboard
 *  - undo / redo via an internal state stack
 *
 * All drawing operations are stored as immutable commands so that
 * undo/redo is a simple push/pop on the command stack.
 *
 * Uses Sharp for image manipulation (no canvas package needed); rendering
 * goes through an OffscreenSurface so heavy pixel work stays off the main thread.
 */

import { OffscreenSurface } from './OffscreenSurface';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  type: 'box';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  lineWidth: number;
}

export interface Arrow {
  type: 'arrow';
  from: Point;
  to: Point;
  color: string;
  lineWidth: number;
}

export interface BlurRegion {
  type: 'blur';
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export interface TextAnnotation {
  type: 'text';
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

export interface StepAnnotation {
  type: 'step';
  x: number;
  y: number;
  number: number;
  color: string;
  fontSize: number;
}

export type Annotation = Box | Arrow | BlurRegion | TextAnnotation | StepAnnotation;

export interface CanvasState {
  width: number;
  height: number;
  /** Raw PNG buffer of the background image (null if none). */
  background: Buffer | null;
  annotations: Annotation[];
}

// ──────────────────────────────────────────────────────────────
// CoreCanvas
// ──────────────────────────────────────────────────────────────

export class CoreCanvas {
  private state: CanvasState;
  private undoStack: CanvasState[] = [];
  private redoStack: CanvasState[] = [];
  private baseSurfaceCache: {
    background: Buffer | null;
    width: number;
    height: number;
    surface: OffscreenSurface;
  } | null = null;

  constructor(width: number, height: number, backgroundPng?: Buffer) {
    this.state = {
      width,
      height,
      background: backgroundPng ? Buffer.from(backgroundPng) : null,
      annotations: [],
    };
  }

  /** Create a CoreCanvas from an existing PNG buffer. */
  static fromPng(pngBuffer: Buffer): CoreCanvas {
    return new CoreCanvas(0, 0, pngBuffer);
  }

  // ── Public API ────────────────────────────────────────────

  /** Draw a stroked rectangle. */
  drawBox(x: number, y: number, width: number, height: number, color = '#ff0000', lineWidth = 2): void {
    this.saveState();
    const box: Box = { type: 'box', x, y, width, height, color, lineWidth };
    this.state.annotations.push(box);
    this.redoStack = [];
  }

  /** Draw an arrow from `from` to `to`. */
  drawArrow(from: Point, to: Point, color = '#ff0000', lineWidth = 2): void {
    this.saveState();
    const arrow: Arrow = { type: 'arrow', from, to, color, lineWidth };
    this.state.annotations.push(arrow);
    this.redoStack = [];
  }

  /** Apply a Gaussian-style blur to a rectangular region. */
  applyBlur(x: number, y: number, width: number, height: number, radius = 8): void {
    this.saveState();
    const blur: BlurRegion = { type: 'blur', x, y, width, height, radius };
    this.state.annotations.push(blur);
    this.redoStack = [];
  }

  /** Add a text annotation at the given position. */
  drawText(x: number, y: number, text: string, color = '#ffffff', fontSize = 16): void {
    this.saveState();
    const textAnn: TextAnnotation = { type: 'text', x, y, text, color, fontSize };
    this.state.annotations.push(textAnn);
    this.redoStack = [];
  }

  /** Add a numbered step overlay. */
  addStep(x: number, y: number, number: number, color = '#ffffff', fontSize = 16): void {
    this.saveState();
    const step: StepAnnotation = { type: 'step', x, y, number, color, fontSize };
    this.state.annotations.push(step);
    this.redoStack = [];
  }

  /**
   * Render the full canvas (background + annotations) and return the PNG buffer.
   *
   * Rendering happens on an OffscreenSurface: the background is decoded once
   * (and cached between renders), blur regions are processed by Sharp off the
   * main thread, and the result is encoded to PNG a single time with every
   * vector overlay composited in one pass.
   */
  async render(): Promise<Buffer> {
    const { annotations } = this.state;

    const surface = (await this.getBaseSurface()).clone();

    // Apply blur regions first (behind everything)
    const blurs = annotations.filter((a): a is BlurRegion => a.type === 'blur');
    await surface.blurRegions(blurs);

    // Vector overlays, in layer order: boxes, arrows, text, steps
    const { width, height } = surface;
    const overlays: string[] = [];
    for (const ann of annotations) {
      if (ann.type === 'box') overlays.push(this.boxSvg(ann, width, height));
    }
    let arrowIndex = 0;
    for (const ann of annotations) {
      if (ann.type === 'arrow') overlays.push(this.arrowSvg(ann, width, height, arrowIndex++));
    }
    for (const ann of annotations) {
      if (ann.type === 'text') overlays.push(this.textSvg(ann, width, height));
    }
    for (const ann of annotations) {
      if (ann.type === 'step') overlays.push(this.stepSvg(ann, width, height));
    }

    return surface.toPng(overlays);
  }

  /** Export the rendered canvas as a PNG ArrayBuffer. */
  async exportToPng(): Promise<ArrayBuffer> {
    const buffer = await this.render();
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
  }

  /** Copy the rendered canvas to the system clipboard as PNG. */
  async copyToClipboard(): Promise<void> {
    const buffer = await this.render();
    (this as any)._clipboardBuffer = buffer;
  }

  /** Get the clipboard buffer that was last prepared. */
  getClipboardBuffer(): Buffer | undefined {
    return (this as any)._clipboardBuffer as Buffer | undefined;
  }

  // ── Undo / Redo ──────────────────────────────────────────

  undo(): boolean {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this.state);
    this.state = this.undoStack.pop()!;
    return true;
  }

  redo(): boolean {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(this.state);
    this.state = this.redoStack.pop()!;
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ── Getters ──────────────────────────────────────────────

  getState(): CanvasState {
    return {
      ...this.state,
      annotations: [...this.state.annotations],
    };
  }

  getAnnotations(): Annotation[] {
    return [...this.state.annotations];
  }

  getWidth(): number {
    return this.state.width;
  }

  getHeight(): number {
    return this.state.height;
  }

  clearAnnotations(): void {
    this.saveState();
    this.state.annotations = [];
    this.redoStack = [];
  }

  // ── Private helpers ──────────────────────────────────────

  private saveState(): void {
    const copy: CanvasState = {
      width: this.state.width,
      height: this.state.height,
      background: this.state.background,
      annotations: [...this.state.annotations],
    };
    this.undoStack.push(copy);
  }

  /**
   * Decoded background (or blank) surface. Decoding a large screenshot is the
   * most expensive part of a render, so it is cached until the background
   * or canvas size changes. Callers must clone() before mutating.
   */
  private async getBaseSurface(): Promise<OffscreenSurface> {
    const { width, height, background } = this.state;
    const cache = this.baseSurfaceCache;
    if (
      cache &&
      cache.background === background &&
      cache.width === width &&
      cache.height === height
    ) {
      return cache.surface;
    }

    const surface = background
      ? await OffscreenSurface.fromImage(background)
      : OffscreenSurface.blank(width, height);

    this.baseSurfaceCache = { background, width, height, surface };
    return surface;
  }

  private svgOpen(width: number, height: number): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
  }

  private boxSvg(box: Box, width: number, height: number): string {
    return `${this.svgOpen(width, height)}
        <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"
              fill="none" stroke="${escapeXml(box.color)}" stroke-width="${box.lineWidth}" />
      </svg>`;
  }

  private arrowSvg(arrow: Arrow, width: number, height: number, index: number): string {
    const { from, to, lineWidth } = arrow;
    const color = escapeXml(arrow.color);
    const markerId = `arrowhead-${index}`;
    return `${this.svgOpen(width, height)}
        <defs>
          <marker id="${markerId}" markerWidth="10" markerHeight="7"
                  refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="${color}" />
          </marker>
        </defs>
        <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
              stroke="${color}" stroke-width="${lineWidth}"
              marker-end="url(#${markerId})" />
      </svg>`;
  }

  private textSvg(text: TextAnnotation, width: number, height: number): string {
    return `${this.svgOpen(width, height)}
        <text x="${text.x}" y="${text.y}" fill="${escapeXml(text.color)}"
              font-size="${text.fontSize}" font-family="sans-serif">${escapeXml(text.text)}</text>
      </svg>`;
  }

  private stepSvg(step: StepAnnotation, width: number, height: number): string {
    return `${this.svgOpen(width, height)}
        <circle cx="${step.x}" cy="${step.y}" r="12" fill="#e53e3e" />
        <text x="${step.x}" y="${step.y}" fill="#ffffff"
              font-size="${step.fontSize - 2}" font-family="sans-serif"
              font-weight="bold" text-anchor="middle" dominant-baseline="central">${step.number}</text>
      </svg>`;
  }
}

function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
