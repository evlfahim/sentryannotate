/**
 * Tests for the offscreen blur pipeline (Step 13).
 *
 * Verifies that:
 *  - blur is actually applied to the requested region only
 *  - rendering does not block the Node.js main thread (event loop stays responsive)
 *  - the cached decoded background is never mutated between renders
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { CoreCanvas, OffscreenSurface } from '@sentry/core';

/** High-contrast 1px checkerboard – blur makes it visibly smoother. */
async function createCheckerboard(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = (x + y) % 2 === 0 ? 0 : 255;
      const i = (y * width + x) * 3;
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function decodeRgba(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Mean absolute difference between horizontally adjacent pixels (red channel). */
function roughness(
  img: { data: Buffer; width: number },
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let total = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1 - 1; x++) {
      const a = img.data[(y * img.width + x) * 4];
      const b = img.data[(y * img.width + x + 1) * 4];
      total += Math.abs(a - b);
      count++;
    }
  }
  return total / count;
}

/** Track the longest gap between timer ticks while `work` runs. */
async function measureMaxEventLoopGap(work: () => Promise<unknown>): Promise<number> {
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 2);
  try {
    await work();
  } finally {
    clearInterval(timer);
  }
  maxGap = Math.max(maxGap, performance.now() - last);
  return maxGap;
}

describe('OffscreenSurface', () => {
  it('creates a blank transparent surface', () => {
    const s = OffscreenSurface.blank(10, 5);
    expect(s.width).toBe(10);
    expect(s.height).toBe(5);
    expect(s.getPixels().length).toBe(10 * 5 * 4);
    expect(s.getPixels().every((b) => b === 0)).toBe(true);
  });

  it('decodes an image into RGBA pixels', async () => {
    const png = await createCheckerboard(20, 10);
    const s = await OffscreenSurface.fromImage(png);
    expect(s.width).toBe(20);
    expect(s.height).toBe(10);
    expect(s.getPixels().length).toBe(20 * 10 * 4);
  });

  it('clamps rectangles to the surface bounds', () => {
    const s = OffscreenSurface.blank(100, 50);
    expect(s.clampRect(-10, -10, 30, 30)).toEqual({ left: 0, top: 0, width: 20, height: 20 });
    expect(s.clampRect(90, 40, 50, 50)).toEqual({ left: 90, top: 40, width: 10, height: 10 });
    // Rectangles dragged "backwards" are normalised
    expect(s.clampRect(50, 30, -20, -10)).toEqual({ left: 30, top: 20, width: 20, height: 10 });
    expect(s.clampRect(200, 200, 10, 10)).toBeNull();
    expect(s.clampRect(10, 10, 0, 10)).toBeNull();
  });

  it('ignores blur regions entirely outside the surface', async () => {
    const png = await createCheckerboard(40, 40);
    const s = await OffscreenSurface.fromImage(png);
    const before = Buffer.from(s.getPixels());
    await s.blurRegion({ type: 'blur', x: 100, y: 100, width: 20, height: 20, radius: 5 });
    expect(s.getPixels().equals(before)).toBe(true);
  });

  it('clone() produces an independent copy', async () => {
    const png = await createCheckerboard(40, 40);
    const original = await OffscreenSurface.fromImage(png);
    const copy = original.clone();
    await copy.blurRegion({ type: 'blur', x: 0, y: 0, width: 40, height: 40, radius: 4 });
    expect(copy.getPixels().equals(original.getPixels())).toBe(false);
  });

  it('wraps a raw RGBA buffer and validates its size', () => {
    const raw = Buffer.alloc(4 * 4 * 4, 7);
    const s = OffscreenSurface.fromRaw(4, 4, raw);
    expect(s.getPixels().equals(raw)).toBe(true);
    expect(() => OffscreenSurface.fromRaw(4, 4, Buffer.alloc(10))).toThrow();
  });
});

describe('CoreCanvas offscreen blur', () => {
  it('blurs only the requested region', async () => {
    const width = 100;
    const height = 60;
    const bg = await createCheckerboard(width, height);
    const original = await decodeRgba(bg);

    const c = new CoreCanvas(width, height, bg);
    c.applyBlur(0, 0, 50, height, 4);
    const out = await decodeRgba(await c.render());

    expect(out.width).toBe(width);
    expect(out.height).toBe(height);

    // Inside the blurred half the checkerboard is smoothed out
    const blurredRoughness = roughness(out, 5, 5, 45, height - 5);
    const originalRoughness = roughness(original, 5, 5, 45, height - 5);
    expect(blurredRoughness).toBeLessThan(originalRoughness / 4);

    // Outside the region the pixels are untouched
    for (let y = 0; y < height; y++) {
      for (let x = 50; x < width; x++) {
        const i = (y * width + x) * 4;
        expect(out.data[i]).toBe(original.data[i]);
      }
    }
  });

  it('does not mutate the cached background between renders', async () => {
    const bg = await createCheckerboard(80, 80);
    const c = new CoreCanvas(80, 80, bg);
    c.applyBlur(10, 10, 40, 40, 6);
    const first = await c.render();
    const second = await c.render();
    expect(second.equals(first)).toBe(true);
  });

  it('undoing a blur restores the unblurred render', async () => {
    const bg = await createCheckerboard(60, 60);
    const c = new CoreCanvas(60, 60, bg);
    const plain = await c.render();

    c.applyBlur(0, 0, 60, 60, 5);
    const blurred = await c.render();
    expect(blurred.equals(plain)).toBe(false);

    c.undo();
    const restored = await c.render();
    expect(restored.equals(plain)).toBe(true);
  });

  it('renders text containing XML special characters', async () => {
    const c = new CoreCanvas(120, 40);
    c.drawText(5, 20, 'a < b & "c"');
    const out = await c.render();
    expect(out[0]).toBe(0x89);
    expect(out.length).toBeGreaterThan(0);
  });

  it('yields to the event loop while rendering', async () => {
    const bg = await createCheckerboard(400, 300);
    const c = new CoreCanvas(400, 300, bg);
    c.applyBlur(0, 0, 400, 300, 20);

    let immediateRan = false;
    setImmediate(() => {
      immediateRan = true;
    });

    let ranBeforeResolve = false;
    await c.render().then(() => {
      ranBeforeResolve = immediateRan;
    });

    expect(ranBeforeResolve).toBe(true);
  });

  it('does not block the main thread when blurring a large screenshot', async () => {
    const width = 1920;
    const height = 1080;
    const raw = Buffer.alloc(width * height * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 31) & 0xff;
    const bg = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();

    const c = new CoreCanvas(width, height, bg);
    c.applyBlur(0, 0, 960, 540, 25);
    c.applyBlur(960, 0, 960, 540, 25);
    c.applyBlur(0, 540, 960, 540, 25);
    c.applyBlur(960, 540, 960, 540, 25);
    c.applyBlur(400, 300, 1000, 500, 40);
    c.drawBox(100, 100, 300, 200);
    c.addStep(50, 50, 1);

    const results: Buffer[] = [];
    const maxGap = await measureMaxEventLoopGap(async () => {
      results.push(await c.render());
    });

    expect(results).toHaveLength(1);
    expect(results[0][0]).toBe(0x89);
    // The heavy convolution runs on Sharp's thread pool; the main thread
    // only does memcpy-sized work, so timers keep firing promptly.
    expect(maxGap).toBeLessThan(250);
  }, 30000);
});
