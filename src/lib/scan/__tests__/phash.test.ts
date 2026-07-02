import { describe, it, expect } from "vitest";
import { phash, hammingHex, isValidHash } from "../phash";
import type { RawImage } from "../raw-image";
import { toGrayscale, resampleGray, cropRaw } from "../raw-image";

/** Build a RawImage from a per-pixel luma function. */
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

const gradientWithShapes = (x: number, y: number) => {
  // Deterministic structured image: gradient + two rectangles
  let v = (x / 2 + y / 3) % 256;
  if (x > 20 && x < 60 && y > 30 && y < 80) v = 230;
  if (x > 70 && x < 110 && y > 100 && y < 150) v = 25;
  return v;
};

describe("phash", () => {
  it("produces a 16-char lowercase hex hash", () => {
    const img = makeImage(128, 180, gradientWithShapes);
    const h = phash(img);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(isValidHash(h)).toBe(true);
  });

  it("is identical for identical images", () => {
    const a = makeImage(128, 180, gradientWithShapes);
    const b = makeImage(128, 180, gradientWithShapes);
    expect(phash(a)).toBe(phash(b));
    expect(hammingHex(phash(a), phash(b))).toBe(0);
  });

  it("is stable under uniform brightness shift", () => {
    const a = makeImage(128, 180, gradientWithShapes);
    const b = makeImage(128, 180, (x, y) => gradientWithShapes(x, y) + 30);
    expect(hammingHex(phash(a), phash(b))).toBeLessThanOrEqual(6);
  });

  it("is stable under moderate rescale", () => {
    const a = makeImage(128, 180, gradientWithShapes);
    const b = makeImage(256, 360, (x, y) => gradientWithShapes(x / 2, y / 2));
    expect(hammingHex(phash(a), phash(b))).toBeLessThanOrEqual(6);
  });

  it("differs strongly for structurally different images", () => {
    const a = makeImage(128, 180, gradientWithShapes);
    // Deterministic pseudo-noise
    const b = makeImage(128, 180, (x, y) => ((x * 7919 + y * 104729) % 251));
    expect(hammingHex(phash(a), phash(b))).toBeGreaterThanOrEqual(15);
  });
});

describe("hammingHex", () => {
  it("computes known distances", () => {
    expect(hammingHex("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingHex("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingHex("0000000000000000", "0000000000000001")).toBe(1);
    expect(hammingHex("f000000000000000", "0000000000000000")).toBe(4);
  });

  it("is symmetric", () => {
    expect(hammingHex("abcdef0123456789", "89abcdef01234567")).toBe(
      hammingHex("89abcdef01234567", "abcdef0123456789")
    );
  });

  it("throws on malformed input", () => {
    expect(() => hammingHex("short", "0000000000000000")).toThrow();
  });
});

describe("raw-image helpers", () => {
  it("toGrayscale converts using Rec. 601 weights", () => {
    const img: RawImage = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([100, 150, 200, 255]),
    };
    const gray = toGrayscale(img);
    expect(gray[0]).toBeCloseTo(0.299 * 100 + 0.587 * 150 + 0.114 * 200, 5);
  });

  it("resampleGray preserves constant images", () => {
    const gray = new Float64Array(100 * 100).fill(77);
    const out = resampleGray(gray, 100, 100, 32, 32);
    expect(out.length).toBe(32 * 32);
    for (const v of out) expect(v).toBeCloseTo(77, 5);
  });

  it("cropRaw extracts the requested region", () => {
    const img = makeImage(10, 10, (x, y) => x + y * 10);
    const crop = cropRaw(img, 2, 3, 4, 5);
    expect(crop.width).toBe(4);
    expect(crop.height).toBe(5);
    // top-left pixel of crop = (2,3) → luma 2 + 30 = 32
    expect(crop.data[0]).toBe(32);
  });

  it("cropRaw clamps out-of-bounds requests", () => {
    const img = makeImage(10, 10, () => 50);
    const crop = cropRaw(img, 8, 8, 10, 10);
    expect(crop.width).toBe(2);
    expect(crop.height).toBe(2);
  });
});
