/**
 * Tests for CoreCanvas – vector operations, blur, steps, export, undo/redo.
 *
 * Uses Sharp to create test images since the canvas package is unavailable.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import { CoreCanvas } from '../src/core/CoreCanvas';
import type { Box, Arrow, BlurRegion, TextAnnotation, StepAnnotation } from '../src/core/CoreCanvas';

// Helper: create a small test image buffer (as PNG)
async function createTestImage(width = 200, height = 150): Promise<Buffer> {
  const rawPixels = Buffer.alloc(width * height * 3, 0);
  for (let i = 0; i < rawPixels.length; i += 3) {
    rawPixels[i] = 128;     // R
    rawPixels[i + 1] = 64;  // G
    rawPixels[i + 2] = 255; // B
  }
  return sharp(rawPixels, {
    raw: { width, height, channels: 3 },
  }).png().toBuffer();
}

describe('CoreCanvas', () => {
  let canvas: CoreCanvas;

  beforeEach(() => {
    canvas = new CoreCanvas(200, 150);
  });

  describe('constructor', () => {
    it('creates a canvas with correct dimensions', () => {
      expect(canvas.getWidth()).toBe(200);
      expect(canvas.getHeight()).toBe(150);
    });

    it('creates a canvas with a background image', async () => {
      const img = await createTestImage(100, 80);
      const c = new CoreCanvas(100, 80, img);
      expect(c.getWidth()).toBe(100);
      expect(c.getHeight()).toBe(80);
      const state = c.getState();
      expect(state.background).not.toBeNull();
      expect(state.annotations).toHaveLength(0);
    });

    it('creates a canvas without background', () => {
      const state = canvas.getState();
      expect(state.background).toBeNull();
    });
  });

  describe('drawBox', () => {
    it('adds a box annotation', () => {
      canvas.drawBox(10, 20, 50, 30);
      const anns = canvas.getAnnotations();
      expect(anns).toHaveLength(1);
      const box = anns[0] as Box;
      expect(box.type).toBe('box');
      expect(box.x).toBe(10);
      expect(box.y).toBe(20);
      expect(box.width).toBe(50);
      expect(box.height).toBe(30);
      expect(box.color).toBe('#ff0000');
      expect(box.lineWidth).toBe(2);
    });

    it('adds a box with custom color and width', () => {
      canvas.drawBox(5, 5, 100, 50, '#00ff00', 4);
      const box = canvas.getAnnotations()[0] as Box;
      expect(box.color).toBe('#00ff00');
      expect(box.lineWidth).toBe(4);
    });
  });

  describe('drawArrow', () => {
    it('adds an arrow annotation', () => {
      canvas.drawArrow({ x: 10, y: 10 }, { x: 100, y: 50 });
      const anns = canvas.getAnnotations();
      expect(anns).toHaveLength(1);
      const arrow = anns[0] as Arrow;
      expect(arrow.type).toBe('arrow');
      expect(arrow.from).toEqual({ x: 10, y: 10 });
      expect(arrow.to).toEqual({ x: 100, y: 50 });
    });

    it('adds an arrow with custom color', () => {
      canvas.drawArrow({ x: 0, y: 0 }, { x: 50, y: 50 }, '#0000ff', 3);
      const arrow = canvas.getAnnotations()[0] as Arrow;
      expect(arrow.color).toBe('#0000ff');
      expect(arrow.lineWidth).toBe(3);
    });
  });

  describe('applyBlur', () => {
    it('adds a blur region annotation', () => {
      canvas.applyBlur(0, 0, 100, 100);
      const anns = canvas.getAnnotations();
      expect(anns).toHaveLength(1);
      const blur = anns[0] as BlurRegion;
      expect(blur.type).toBe('blur');
      expect(blur.x).toBe(0);
      expect(blur.y).toBe(0);
      expect(blur.width).toBe(100);
      expect(blur.height).toBe(100);
      expect(blur.radius).toBe(8);
    });

    it('adds a blur with custom radius', () => {
      canvas.applyBlur(10, 20, 50, 50, 15);
      const blur = canvas.getAnnotations()[0] as BlurRegion;
      expect(blur.radius).toBe(15);
    });
  });

  describe('drawText', () => {
    it('adds a text annotation', () => {
      canvas.drawText(10, 20, 'Hello');
      const anns = canvas.getAnnotations();
      expect(anns).toHaveLength(1);
      const text = anns[0] as TextAnnotation;
      expect(text.type).toBe('text');
      expect(text.x).toBe(10);
      expect(text.y).toBe(20);
      expect(text.text).toBe('Hello');
      expect(text.color).toBe('#ffffff');
      expect(text.fontSize).toBe(16);
    });

    it('adds text with custom style', () => {
      canvas.drawText(5, 5, 'Custom', '#ff0000', 24);
      const text = canvas.getAnnotations()[0] as TextAnnotation;
      expect(text.color).toBe('#ff0000');
      expect(text.fontSize).toBe(24);
    });
  });

  describe('addStep', () => {
    it('adds a numbered step annotation', () => {
      canvas.addStep(50, 50, 1);
      const anns = canvas.getAnnotations();
      expect(anns).toHaveLength(1);
      const step = anns[0] as StepAnnotation;
      expect(step.type).toBe('step');
      expect(step.x).toBe(50);
      expect(step.y).toBe(50);
      expect(step.number).toBe(1);
    });

    it('adds a step with custom style', () => {
      canvas.addStep(10, 10, 5, '#00ff00', 20);
      const step = canvas.getAnnotations()[0] as StepAnnotation;
      expect(step.number).toBe(5);
      expect(step.color).toBe('#00ff00');
      expect(step.fontSize).toBe(20);
    });
  });

  describe('render', () => {
    it('renders without annotations', async () => {
      const buffer = await canvas.render();
      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('renders with a background image', async () => {
      const img = await createTestImage(200, 150);
      const c = new CoreCanvas(200, 150, img);
      c.drawBox(10, 10, 50, 50);
      const buffer = await c.render();
      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('renders with all annotation types', async () => {
      canvas.drawBox(10, 10, 50, 50);
      canvas.drawArrow({ x: 0, y: 0 }, { x: 100, y: 100 });
      canvas.applyBlur(0, 0, 50, 50);
      canvas.drawText(10, 10, 'Hello');
      canvas.addStep(100, 100, 1);
      const buffer = await canvas.render();
      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('renders a valid PNG', async () => {
      canvas.drawBox(10, 10, 50, 50);
      const buffer = await canvas.render();
      // Verify it's a valid PNG by checking the magic bytes
      expect(buffer[0]).toBe(0x89); // PNG magic byte
      expect(buffer[1]).toBe(0x50); // 'P'
      expect(buffer[2]).toBe(0x4E); // 'N'
      expect(buffer[3]).toBe(0x47); // 'G'
    });
  });

  describe('exportToPng', () => {
    it('returns an ArrayBuffer', async () => {
      canvas.drawBox(10, 10, 50, 50);
      const ab = await canvas.exportToPng();
      expect(ab).toBeInstanceOf(ArrayBuffer);
      expect(ab.byteLength).toBeGreaterThan(0);
    });

    it('returns valid PNG data', async () => {
      const ab = await canvas.exportToPng();
      const view = new Uint8Array(ab);
      expect(view[0]).toBe(0x89);
      expect(view[1]).toBe(0x50);
      expect(view[2]).toBe(0x4E);
      expect(view[3]).toBe(0x47);
    });
  });

  describe('copyToClipboard', () => {
    it('stores the buffer for clipboard access', async () => {
      canvas.drawBox(10, 10, 50, 50);
      await canvas.copyToClipboard();
      const buffer = canvas.getClipboardBuffer();
      expect(buffer).toBeDefined();
      expect(buffer!.length).toBeGreaterThan(0);
    });
  });

  describe('undo / redo', () => {
    it('can undo a drawBox', () => {
      canvas.drawBox(10, 10, 50, 50);
      expect(canvas.getAnnotations()).toHaveLength(1);
      expect(canvas.canUndo()).toBe(true);
      expect(canvas.canRedo()).toBe(false);

      canvas.undo();
      expect(canvas.getAnnotations()).toHaveLength(0);
      expect(canvas.canUndo()).toBe(false);
      expect(canvas.canRedo()).toBe(true);
    });

    it('can redo after undo', () => {
      canvas.drawBox(10, 10, 50, 50);
      canvas.undo();
      canvas.redo();
      expect(canvas.getAnnotations()).toHaveLength(1);
      expect(canvas.canRedo()).toBe(false);
    });

    it('can undo multiple operations', () => {
      canvas.drawBox(10, 10, 50, 50);
      canvas.drawArrow({ x: 0, y: 0 }, { x: 100, y: 100 });
      canvas.applyBlur(0, 0, 50, 50);
      expect(canvas.getAnnotations()).toHaveLength(3);

      canvas.undo();
      expect(canvas.getAnnotations()).toHaveLength(2);

      canvas.undo();
      expect(canvas.getAnnotations()).toHaveLength(1);

      canvas.undo();
      expect(canvas.getAnnotations()).toHaveLength(0);
    });

    it('clears redo stack after new operation', () => {
      canvas.drawBox(10, 10, 50, 50);
      canvas.undo();
      expect(canvas.canRedo()).toBe(true);

      canvas.drawBox(20, 20, 30, 30);
      expect(canvas.canRedo()).toBe(false);
    });

    it('returns false when undo/redo is empty', () => {
      expect(canvas.undo()).toBe(false);
      expect(canvas.redo()).toBe(false);
    });
  });

  describe('clearAnnotations', () => {
    it('removes all annotations', () => {
      canvas.drawBox(10, 10, 50, 50);
      canvas.drawArrow({ x: 0, y: 0 }, { x: 100, y: 100 });
      expect(canvas.getAnnotations()).toHaveLength(2);

      canvas.clearAnnotations();
      expect(canvas.getAnnotations()).toHaveLength(0);
    });

    it('allows undo after clear', () => {
      canvas.drawBox(10, 10, 50, 50);
      canvas.clearAnnotations();
      canvas.undo();
      expect(canvas.getAnnotations()).toHaveLength(1);
    });
  });

  describe('getState', () => {
    it('returns a copy of the state', () => {
      canvas.drawBox(10, 10, 50, 50);
      const state = canvas.getState();
      expect(state.width).toBe(200);
      expect(state.height).toBe(150);
      expect(state.annotations).toHaveLength(1);

      // Modifying the returned state shouldn't affect the canvas
      state.annotations.push({ type: 'box', x: 0, y: 0, width: 1, height: 1, color: '#000', lineWidth: 1 });
      expect(canvas.getAnnotations()).toHaveLength(1);
    });
  });

  describe('fromPng', () => {
    it('creates a canvas from a PNG buffer', async () => {
      const img = await createTestImage(100, 80);
      const c = CoreCanvas.fromPng(img);
      expect(c.getWidth()).toBe(0);
      expect(c.getHeight()).toBe(0);
      const state = c.getState();
      expect(state.background).not.toBeNull();
    });
  });
});
