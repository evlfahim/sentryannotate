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
export declare class CoreCanvas {
    private state;
    private undoStack;
    private redoStack;
    constructor(width: number, height: number, backgroundPng?: Buffer);
    /** Create a CoreCanvas from an existing PNG buffer. */
    static fromPng(pngBuffer: Buffer): CoreCanvas;
    /** Draw a stroked rectangle. */
    drawBox(x: number, y: number, width: number, height: number, color?: string, lineWidth?: number): void;
    /** Draw an arrow from `from` to `to`. */
    drawArrow(from: Point, to: Point, color?: string, lineWidth?: number): void;
    /** Apply a Gaussian-style blur to a rectangular region. */
    applyBlur(x: number, y: number, width: number, height: number, radius?: number): void;
    /** Add a text annotation at the given position. */
    drawText(x: number, y: number, text: string, color?: string, fontSize?: number): void;
    /** Add a numbered step overlay. */
    addStep(x: number, y: number, number: number, color?: string, fontSize?: number): void;
    /** Render the full canvas (background + annotations) and return the PNG buffer. */
    render(): Promise<Buffer>;
    /** Export the rendered canvas as a PNG ArrayBuffer. */
    exportToPng(): Promise<ArrayBuffer>;
    /** Copy the rendered canvas to the system clipboard as PNG. */
    copyToClipboard(): Promise<void>;
    /** Get the clipboard buffer that was last prepared. */
    getClipboardBuffer(): Buffer | undefined;
    undo(): boolean;
    redo(): boolean;
    canUndo(): boolean;
    canRedo(): boolean;
    getState(): CanvasState;
    getAnnotations(): Annotation[];
    getWidth(): number;
    getHeight(): number;
    clearAnnotations(): void;
    private saveState;
    private applyBlurToBuffer;
    private drawBoxOnBuffer;
    private drawArrowOnBuffer;
    private drawTextOnBuffer;
    private drawStepOnBuffer;
}
//# sourceMappingURL=CoreCanvas.d.ts.map