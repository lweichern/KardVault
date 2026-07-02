import { describe, it, expect } from "vitest";
import {
  solveHomography,
  applyHomography,
  orderCorners,
  warpPerspective,
  type Point,
} from "../geometry";
import type { RawImage } from "../raw-image";

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

describe("solveHomography", () => {
  it("recovers an exact translation", () => {
    const from: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const to = from.map((p) => ({ x: p.x + 5, y: p.y + 7 }));
    const h = solveHomography(from, to);
    for (let i = 0; i < 4; i++) {
      const mapped = applyHomography(h, from[i]);
      expect(mapped.x).toBeCloseTo(to[i].x, 6);
      expect(mapped.y).toBeCloseTo(to[i].y, 6);
    }
  });

  it("recovers a scale + rotation", () => {
    const from: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const angle = Math.PI / 6;
    const s = 1.5;
    const to = from.map((p) => ({
      x: s * (p.x * Math.cos(angle) - p.y * Math.sin(angle)) + 20,
      y: s * (p.x * Math.sin(angle) + p.y * Math.cos(angle)) - 10,
    }));
    const h = solveHomography(from, to);
    for (let i = 0; i < 4; i++) {
      const mapped = applyHomography(h, from[i]);
      expect(mapped.x).toBeCloseTo(to[i].x, 4);
      expect(mapped.y).toBeCloseTo(to[i].y, 4);
    }
    // Interior point maps consistently under affine transform
    const mid = applyHomography(h, { x: 50, y: 50 });
    expect(mid.x).toBeCloseTo(s * (50 * Math.cos(angle) - 50 * Math.sin(angle)) + 20, 4);
  });

  it("throws on degenerate (collinear) points", () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(() => solveHomography(line, line)).toThrow();
  });
});

describe("orderCorners", () => {
  it("orders shuffled corners TL, TR, BR, BL", () => {
    const tl = { x: 10, y: 10 };
    const tr = { x: 90, y: 12 };
    const br = { x: 88, y: 130 };
    const bl = { x: 8, y: 128 };
    const [a, b, c, d] = orderCorners([br, tl, bl, tr]);
    expect(a).toEqual(tl);
    expect(b).toEqual(tr);
    expect(c).toEqual(br);
    expect(d).toEqual(bl);
  });
});

describe("warpPerspective", () => {
  it("identity quad reproduces the source image", () => {
    const img = makeImage(40, 60, (x, y) => (x * 4 + y * 2) % 256);
    const out = warpPerspective(
      img,
      [
        { x: 0, y: 0 },
        { x: 39, y: 0 },
        { x: 39, y: 59 },
        { x: 0, y: 59 },
      ],
      40,
      60
    );
    // Sample several pixels — bilinear at integer coords is exact
    for (const [x, y] of [
      [0, 0],
      [10, 20],
      [39, 59],
      [20, 30],
    ] as const) {
      const p = (y * 40 + x) * 4;
      expect(out.data[p]).toBe(img.data[p]);
    }
  });

  it("axis-aligned sub-quad equals a crop", () => {
    const img = makeImage(100, 100, (x, y) => x + y);
    const out = warpPerspective(
      img,
      [
        { x: 20, y: 30 },
        { x: 29, y: 30 },
        { x: 29, y: 49 },
        { x: 20, y: 49 },
      ],
      10,
      20
    );
    expect(out.width).toBe(10);
    expect(out.height).toBe(20);
    // Pixel (0,0) of output should be source (20,30) → luma 50
    expect(out.data[0]).toBe(50);
    // Pixel (9,19) → source (29,49) → luma 78
    expect(out.data[(19 * 10 + 9) * 4]).toBe(78);
  });

  it("recovers a bright rotated rectangle into a full frame", () => {
    // White rectangle rotated 15° on black background
    const angle = (15 * Math.PI) / 180;
    const cx = 100;
    const cy = 100;
    const rw = 50;
    const rh = 70;
    const corner = (dx: number, dy: number): Point => ({
      x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
    });
    const corners: [Point, Point, Point, Point] = [
      corner(-rw, -rh),
      corner(rw, -rh),
      corner(rw, rh),
      corner(-rw, rh),
    ];
    const img = makeImage(200, 200, (x, y) => {
      // Inverse-rotate the pixel; inside rect → white
      const dx = x - cx;
      const dy = y - cy;
      const rx = dx * Math.cos(-angle) - dy * Math.sin(-angle);
      const ry = dx * Math.sin(-angle) + dy * Math.cos(-angle);
      return Math.abs(rx) < rw && Math.abs(ry) < rh ? 255 : 0;
    });

    const out = warpPerspective(img, corners, 50, 70);
    // Center of the warped output must be white
    const center = ((35 * 50) + 25) * 4;
    expect(out.data[center]).toBeGreaterThan(200);
    // Average luma should be high (mostly rectangle interior)
    let sum = 0;
    for (let i = 0; i < out.data.length; i += 4) sum += out.data[i];
    expect(sum / (50 * 70)).toBeGreaterThan(180);
  });
});
