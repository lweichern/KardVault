import { describe, it, expect } from "vitest";
import { detectCardQuad, blurScore, glareScore, BLUR_MIN } from "../detect";
import type { RawImage } from "../raw-image";
import type { Point } from "../geometry";

function makeImage(
  width: number,
  height: number,
  fn: (x: number, y: number) => number
): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, fn(x, y)));
      const p = (y * width + x) * 4;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Bright rectangle rotated by `deg` centred in a dark frame. */
function rotatedRectImage(
  w: number,
  h: number,
  rw: number,
  rh: number,
  deg: number
): { img: RawImage; corners: Point[] } {
  const angle = (deg * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const img = makeImage(w, h, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const rx = dx * Math.cos(-angle) - dy * Math.sin(-angle);
    const ry = dx * Math.sin(-angle) + dy * Math.cos(-angle);
    return Math.abs(rx) < rw / 2 && Math.abs(ry) < rh / 2 ? 220 : 15;
  });
  const corner = (sx: number, sy: number): Point => ({
    x: cx + (sx * rw) / 2 * Math.cos(angle) - (sy * rh) / 2 * Math.sin(angle),
    y: cy + (sx * rw) / 2 * Math.sin(angle) + (sy * rh) / 2 * Math.cos(angle),
  });
  return {
    img,
    corners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
  };
}

describe("detectCardQuad", () => {
  it("finds an axis-aligned card-like rectangle", () => {
    const { img, corners } = rotatedRectImage(320, 320, 180, 250, 0);
    const result = detectCardQuad(img);
    expect(result).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(result!.corners[i].x - corners[i].x)).toBeLessThanOrEqual(6);
      expect(Math.abs(result!.corners[i].y - corners[i].y)).toBeLessThanOrEqual(6);
    }
    expect(result!.score).toBeGreaterThan(0.5);
  });

  it("finds a slightly rotated rectangle", () => {
    const { img, corners } = rotatedRectImage(320, 320, 180, 250, 6);
    const result = detectCardQuad(img);
    expect(result).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(result!.corners[i].x - corners[i].x)).toBeLessThanOrEqual(10);
      expect(Math.abs(result!.corners[i].y - corners[i].y)).toBeLessThanOrEqual(10);
    }
  });

  it("returns null on a blank frame", () => {
    const img = makeImage(320, 320, () => 128);
    expect(detectCardQuad(img)).toBeNull();
  });

  it("returns null when the shape is too small", () => {
    const { img } = rotatedRectImage(320, 320, 60, 84, 0); // ~4.9% of frame
    expect(detectCardQuad(img)).toBeNull();
  });

  it("returns null for a landscape (non-card) aspect", () => {
    const { img } = rotatedRectImage(320, 320, 260, 120, 0); // aspect > 1
    expect(detectCardQuad(img)).toBeNull();
  });

  it("scales corners back to original resolution", () => {
    const { img, corners } = rotatedRectImage(640, 640, 360, 500, 0);
    const result = detectCardQuad(img);
    expect(result).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(result!.corners[i].x - corners[i].x)).toBeLessThanOrEqual(12);
      expect(Math.abs(result!.corners[i].y - corners[i].y)).toBeLessThanOrEqual(12);
    }
  });
});

describe("blurScore", () => {
  it("scores a checkerboard far sharper than a flat image", () => {
    const sharp = makeImage(100, 100, (x, y) => ((x + y) % 2 === 0 ? 0 : 255));
    const flat = makeImage(100, 100, () => 128);
    expect(blurScore(sharp)).toBeGreaterThan(10000);
    expect(blurScore(flat)).toBe(0);
  });

  it("scores a smooth gradient below the blur threshold", () => {
    const smooth = makeImage(100, 100, (x, y) => (x + y) / 2);
    expect(blurScore(smooth)).toBeLessThan(BLUR_MIN);
  });
});

describe("glareScore", () => {
  it("is ~1 for a blown-out image", () => {
    const white = makeImage(50, 50, () => 255);
    expect(glareScore(white)).toBeGreaterThan(0.99);
  });

  it("is 0 for a mid-gray image", () => {
    const gray = makeImage(50, 50, () => 128);
    expect(glareScore(gray)).toBe(0);
  });

  it("reflects the blown fraction", () => {
    const half = makeImage(50, 50, (x) => (x < 25 ? 255 : 100));
    const score = glareScore(half);
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(0.6);
  });
});
