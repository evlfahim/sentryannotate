/**
 * OffscreenSurface – a raw RGBA pixel buffer used as an offscreen canvas.
 *
 * The previous render pipeline re-encoded the whole image to PNG three
 * times per blur region (extract → blur → composite) and once more for
 * every vector annotation. On a 4K screenshot that is a lot of zlib work.
 *
 * OffscreenSurface decodes the background exactly once into raw pixels,
 * blurs each region by handing only that region to Sharp (which runs on
 * the libuv thread pool, off the main thread), copies the blurred rows
 * back in place, and encodes to PNG a single time at the very end with
 * all overlays composited in one pass.
 *
 * The only work done on the main thread is row-level Buffer.copy calls,
 * which are memcpy-speed and never block the event loop noticeably.
 */

import sharp from 'sharp';
import type { BlurRegion } from './CoreCanvas';

const CHANNELS = 4;

/** Sharp rejects sigma values below 0.3. */
const MIN_SIGMA = 0.3;

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class OffscreenSurface {
  private constructor(
    readonly width: number,
    readonly height: number,
    private readonly pixels: Buffer,
  ) {}

  /** Create a fully transparent surface. */
  static blank(width: number, height: number): OffscreenSurface {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    return new OffscreenSurface(w, h, Buffer.alloc(w * h * CHANNELS, 0));
  }

  /** Decode an encoded image (PNG, JPEG, …) into an RGBA surface. */
  static async fromImage(encoded: Buffer): Promise<OffscreenSurface> {
    const { data, info } = await sharp(encoded)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return new OffscreenSurface(info.width, info.height, data);
  }

  /** Wrap an existing RGBA buffer (copied so the source stays untouched). */
  static fromRaw(width: number, height: number, rgba: Buffer): OffscreenSurface {
    if (rgba.length !== width * height * CHANNELS) {
      throw new Error(
        `OffscreenSurface.fromRaw: expected ${width * height * CHANNELS} bytes, got ${rgba.length}`,
      );
    }
    return new OffscreenSurface(width, height, Buffer.from(rgba));
  }

  /** Independent copy of this surface. */
  clone(): OffscreenSurface {
    return new OffscreenSurface(this.width, this.height, Buffer.from(this.pixels));
  }

  /** Direct access to the RGBA pixel data (row-major, 4 bytes per pixel). */
  getPixels(): Buffer {
    return this.pixels;
  }

  /** Clamp a rectangle to the surface bounds; returns null if empty. */
  clampRect(x: number, y: number, width: number, height: number): PixelRect | null {
    // Normalise rectangles drawn "backwards" (negative width/height)
    let left = Math.round(width < 0 ? x + width : x);
    let top = Math.round(height < 0 ? y + height : y);
    let right = left + Math.round(Math.abs(width));
    let bottom = top + Math.round(Math.abs(height));

    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(this.width, right);
    bottom = Math.min(this.height, bottom);

    if (right <= left || bottom <= top) return null;
    return { left, top, width: right - left, height: bottom - top };
  }

  /**
   * Blur a single region in place. Sharp performs the convolution on its
   * worker threads; only the region (not the whole image) is transferred.
   */
  async blurRegion(region: BlurRegion): Promise<void> {
    const rect = this.clampRect(region.x, region.y, region.width, region.height);
    if (!rect) return;

    const sigma = Math.max(MIN_SIGMA, region.radius);

    const blurred = await sharp(this.pixels, {
      raw: { width: this.width, height: this.height, channels: CHANNELS },
    })
      .extract(rect)
      .blur(sigma)
      .raw()
      .toBuffer();

    this.writeRect(rect, blurred);
  }

  /** Blur several regions in order (later regions see earlier results). */
  async blurRegions(regions: BlurRegion[]): Promise<void> {
    for (const region of regions) {
      await this.blurRegion(region);
    }
  }

  /**
   * Encode to PNG, compositing the given SVG overlays (in order) on top.
   * This is the only PNG encode in the whole render.
   */
  async toPng(svgOverlays: string[] = []): Promise<Buffer> {
    let pipeline = sharp(this.pixels, {
      raw: { width: this.width, height: this.height, channels: CHANNELS },
    });

    if (svgOverlays.length > 0) {
      pipeline = pipeline.composite(
        svgOverlays.map((svg) => ({
          input: Buffer.from(svg),
          top: 0,
          left: 0,
          blend: 'over' as const,
        })),
      );
    }

    return pipeline.png().toBuffer();
  }

  /** Copy a tightly packed RGBA block back into the surface. */
  private writeRect(rect: PixelRect, block: Buffer): void {
    const rowBytes = rect.width * CHANNELS;
    const stride = this.width * CHANNELS;
    for (let row = 0; row < rect.height; row++) {
      const srcStart = row * rowBytes;
      const dstStart = (rect.top + row) * stride + rect.left * CHANNELS;
      block.copy(this.pixels, dstStart, srcStart, srcStart + rowBytes);
    }
  }
}
