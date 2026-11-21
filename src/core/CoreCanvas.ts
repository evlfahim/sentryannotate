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
 * Uses Sharp for image manipulation (no canvas package needed).
 */

import sharp from 'sharp';

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

  /** Render the full canvas (background + annotations) and return the PNG buffer. */
  async render(): Promise<Buffer> {
    const { width, height, background, annotations } = this.state;

    // Start with the background image or a blank canvas
    let compositeImage: Buffer;

    if (background) {
      // Use the stored PNG buffer directly
      compositeImage = await sharp(background).toBuffer();
    } else {
      // Create a blank RGBA image using Sharp's raw input format
      const rawPixels = Buffer.alloc(width * height * 4, 0);
      compositeImage = await sharp(rawPixels, {
        raw: { width, height, channels: 4 },
      }).png().toBuffer();
    }

    // Apply blur regions first (behind everything)
    for (const ann of annotations) {
      if (ann.type === 'blur') {
        compositeImage = await this.applyBlurToBuffer(compositeImage, ann);
      }
    }

    // Draw boxes on top
    for (const ann of annotations) {
      if (ann.type === 'box') {
        compositeImage = await this.drawBoxOnBuffer(compositeImage, ann);
      }
    }

    // Draw arrows on top
    for (const ann of annotations) {
      if (ann.type === 'arrow') {
        compositeImage = await this.drawArrowOnBuffer(compositeImage, ann);
      }
    }

    // Draw text on top
    for (const ann of annotations) {
      if (ann.type === 'text') {
        compositeImage = await this.drawTextOnBuffer(compositeImage, ann);
      }
    }

    // Draw steps on top
    for (const ann of annotations) {
      if (ann.type === 'step') {
        compositeImage = await this.drawStepOnBuffer(compositeImage, ann);
      }
    }

    return compositeImage;
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

  private async applyBlurToBuffer(
    image: Buffer,
    blur: BlurRegion,
  ): Promise<Buffer> {
    const { x, y, width, height, radius } = blur;

    // Clamp to image bounds
    const clampedX = Math.max(0, Math.round(x));
    const clampedY = Math.max(0, Math.round(y));
    const clampedW = Math.min(this.state.width - clampedX, Math.round(width));
    const clampedH = Math.min(this.state.height - clampedY, Math.round(height));

    if (clampedW <= 0 || clampedH <= 0) return image;

    // Extract the region
    const region = await sharp(image)
      .extract({
        left: clampedX,
        top: clampedY,
        width: clampedW,
        height: clampedH,
      })
      .toBuffer();

    // Apply blur using Sharp's built-in blur
    const blurred = await sharp(region)
      .blur(radius)
      .toBuffer();

    // Composite the blurred region back onto the original image
    return sharp(image)
      .composite([
        {
          input: blurred,
          left: clampedX,
          top: clampedY,
        },
      ])
      .toBuffer();
  }

  private async drawBoxOnBuffer(
    image: Buffer,
    box: Box,
  ): Promise<Buffer> {
    // Draw the box using SVG
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${this.state.width}" height="${this.state.height}">
        <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"
              fill="none" stroke="${box.color}" stroke-width="${box.lineWidth}" />
      </svg>
    `;

    const overlayBuffer = await sharp(Buffer.from(svg))
      .resize(this.state.width, this.state.height)
      .toBuffer();

    return sharp(image)
      .composite([{ input: overlayBuffer, blend: 'over' }])
      .toBuffer();
  }

  private async drawArrowOnBuffer(
    image: Buffer,
    arrow: Arrow,
  ): Promise<Buffer> {
    const { from, to, color, lineWidth } = arrow;

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${this.state.width}" height="${this.state.height}">
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7"
                  refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="${color}" />
          </marker>
        </defs>
        <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
              stroke="${color}" stroke-width="${lineWidth}"
              marker-end="url(#arrowhead)" />
      </svg>
    `;

    const overlayBuffer = await sharp(Buffer.from(svg))
      .resize(this.state.width, this.state.height)
      .toBuffer();

    return sharp(image)
      .composite([{ input: overlayBuffer, blend: 'over' }])
      .toBuffer();
  }

  private async drawTextOnBuffer(
    image: Buffer,
    text: TextAnnotation,
  ): Promise<Buffer> {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${this.state.width}" height="${this.state.height}">
        <text x="${text.x}" y="${text.y}" fill="${text.color}"
              font-size="${text.fontSize}" font-family="sans-serif">
          ${text.text}
        </text>
      </svg>
    `;

    const overlayBuffer = await sharp(Buffer.from(svg))
      .resize(this.state.width, this.state.height)
      .toBuffer();

    return sharp(image)
      .composite([{ input: overlayBuffer, blend: 'over' }])
      .toBuffer();
  }

  private async drawStepOnBuffer(
    image: Buffer,
    step: StepAnnotation,
  ): Promise<Buffer> {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${this.state.width}" height="${this.state.height}">
        <circle cx="${step.x}" cy="${step.y}" r="12" fill="#e53e3e" />
        <text x="${step.x}" y="${step.y}" fill="#ffffff"
              font-size="${step.fontSize - 2}" font-family="sans-serif"
              font-weight="bold" text-anchor="middle" dominant-baseline="central">
          ${step.number}
        </text>
      </svg>
    `;

    const overlayBuffer = await sharp(Buffer.from(svg))
      .resize(this.state.width, this.state.height)
      .toBuffer();

    return sharp(image)
      .composite([{ input: overlayBuffer, blend: 'over' }])
      .toBuffer();
  }
}
