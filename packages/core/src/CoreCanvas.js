"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoreCanvas = void 0;
const sharp_1 = __importDefault(require("sharp"));
// ──────────────────────────────────────────────────────────────
// CoreCanvas
// ──────────────────────────────────────────────────────────────
class CoreCanvas {
    constructor(width, height, backgroundPng) {
        this.undoStack = [];
        this.redoStack = [];
        this.state = {
            width,
            height,
            background: backgroundPng ? Buffer.from(backgroundPng) : null,
            annotations: [],
        };
    }
    /** Create a CoreCanvas from an existing PNG buffer. */
    static fromPng(pngBuffer) {
        return new CoreCanvas(0, 0, pngBuffer);
    }
    // ── Public API ────────────────────────────────────────────
    /** Draw a stroked rectangle. */
    drawBox(x, y, width, height, color = '#ff0000', lineWidth = 2) {
        this.saveState();
        const box = { type: 'box', x, y, width, height, color, lineWidth };
        this.state.annotations.push(box);
        this.redoStack = [];
    }
    /** Draw an arrow from `from` to `to`. */
    drawArrow(from, to, color = '#ff0000', lineWidth = 2) {
        this.saveState();
        const arrow = { type: 'arrow', from, to, color, lineWidth };
        this.state.annotations.push(arrow);
        this.redoStack = [];
    }
    /** Apply a Gaussian-style blur to a rectangular region. */
    applyBlur(x, y, width, height, radius = 8) {
        this.saveState();
        const blur = { type: 'blur', x, y, width, height, radius };
        this.state.annotations.push(blur);
        this.redoStack = [];
    }
    /** Add a text annotation at the given position. */
    drawText(x, y, text, color = '#ffffff', fontSize = 16) {
        this.saveState();
        const textAnn = { type: 'text', x, y, text, color, fontSize };
        this.state.annotations.push(textAnn);
        this.redoStack = [];
    }
    /** Add a numbered step overlay. */
    addStep(x, y, number, color = '#ffffff', fontSize = 16) {
        this.saveState();
        const step = { type: 'step', x, y, number, color, fontSize };
        this.state.annotations.push(step);
        this.redoStack = [];
    }
    /** Render the full canvas (background + annotations) and return the PNG buffer. */
    async render() {
        const { width, height, background, annotations } = this.state;
        // Start with the background image or a blank canvas
        let compositeImage;
        if (background) {
            // Use the stored PNG buffer directly
            compositeImage = await (0, sharp_1.default)(background).toBuffer();
        }
        else {
            // Create a blank RGBA image using Sharp's raw input format
            const rawPixels = Buffer.alloc(width * height * 4, 0);
            compositeImage = await (0, sharp_1.default)(rawPixels, {
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
    async exportToPng() {
        const buffer = await this.render();
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    /** Copy the rendered canvas to the system clipboard as PNG. */
    async copyToClipboard() {
        const buffer = await this.render();
        this._clipboardBuffer = buffer;
    }
    /** Get the clipboard buffer that was last prepared. */
    getClipboardBuffer() {
        return this._clipboardBuffer;
    }
    // ── Undo / Redo ──────────────────────────────────────────
    undo() {
        if (this.undoStack.length === 0)
            return false;
        this.redoStack.push(this.state);
        this.state = this.undoStack.pop();
        return true;
    }
    redo() {
        if (this.redoStack.length === 0)
            return false;
        this.undoStack.push(this.state);
        this.state = this.redoStack.pop();
        return true;
    }
    canUndo() {
        return this.undoStack.length > 0;
    }
    canRedo() {
        return this.redoStack.length > 0;
    }
    // ── Getters ──────────────────────────────────────────────
    getState() {
        return {
            ...this.state,
            annotations: [...this.state.annotations],
        };
    }
    getAnnotations() {
        return [...this.state.annotations];
    }
    getWidth() {
        return this.state.width;
    }
    getHeight() {
        return this.state.height;
    }
    clearAnnotations() {
        this.saveState();
        this.state.annotations = [];
        this.redoStack = [];
    }
    // ── Private helpers ──────────────────────────────────────
    saveState() {
        const copy = {
            width: this.state.width,
            height: this.state.height,
            background: this.state.background,
            annotations: [...this.state.annotations],
        };
        this.undoStack.push(copy);
    }
    async applyBlurToBuffer(image, blur) {
        const { x, y, width, height, radius } = blur;
        // Clamp to image bounds
        const clampedX = Math.max(0, Math.round(x));
        const clampedY = Math.max(0, Math.round(y));
        const clampedW = Math.min(this.state.width - clampedX, Math.round(width));
        const clampedH = Math.min(this.state.height - clampedY, Math.round(height));
        if (clampedW <= 0 || clampedH <= 0)
            return image;
        // Extract the region
        const region = await (0, sharp_1.default)(image)
            .extract({
            left: clampedX,
            top: clampedY,
            width: clampedW,
            height: clampedH,
        })
            .toBuffer();
        // Apply blur using Sharp's built-in blur
        const blurred = await (0, sharp_1.default)(region)
            .blur(radius)
            .toBuffer();
        // Composite the blurred region back onto the original image
        return (0, sharp_1.default)(image)
            .composite([
            {
                input: blurred,
                left: clampedX,
                top: clampedY,
            },
        ])
            .toBuffer();
    }
    async drawBoxOnBuffer(image, box) {
        // Draw the box using SVG
        const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${this.state.width}" height="${this.state.height}">
        <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"
              fill="none" stroke="${box.color}" stroke-width="${box.lineWidth}" />
      </svg>
    `;
        const overlayBuffer = await (0, sharp_1.default)(Buffer.from(svg))
            .resize(this.state.width, this.state.height)
            .toBuffer();
        return (0, sharp_1.default)(image)
            .composite([{ input: overlayBuffer, blend: 'over' }])
            .toBuffer();
    }
    async drawArrowOnBuffer(image, arrow) {
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
        const overlayBuffer = await (0, sharp_1.default)(Buffer.from(svg))
            .resize(this.state.width, this.state.height)
            .toBuffer();
        return (0, sharp_1.default)(image)
            .composite([{ input: overlayBuffer, blend: 'over' }])
            .toBuffer();
    }
    async drawTextOnBuffer(image, text) {
        const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${this.state.width}" height="${this.state.height}">
        <text x="${text.x}" y="${text.y}" fill="${text.color}"
              font-size="${text.fontSize}" font-family="sans-serif">
          ${text.text}
        </text>
      </svg>
    `;
        const overlayBuffer = await (0, sharp_1.default)(Buffer.from(svg))
            .resize(this.state.width, this.state.height)
            .toBuffer();
        return (0, sharp_1.default)(image)
            .composite([{ input: overlayBuffer, blend: 'over' }])
            .toBuffer();
    }
    async drawStepOnBuffer(image, step) {
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
        const overlayBuffer = await (0, sharp_1.default)(Buffer.from(svg))
            .resize(this.state.width, this.state.height)
            .toBuffer();
        return (0, sharp_1.default)(image)
            .composite([{ input: overlayBuffer, blend: 'over' }])
            .toBuffer();
    }
}
exports.CoreCanvas = CoreCanvas;
//# sourceMappingURL=CoreCanvas.js.map