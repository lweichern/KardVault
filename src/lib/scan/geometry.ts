// Homography estimation + perspective warp for flattening detected card quads
// into a canonical crop (CLAUDE-enhance.md §3.2). Pure TS, canvas-free.

import type { RawImage } from "./raw-image";

export interface Point {
  x: number;
  y: number;
}

// Canonical warped card size — 63:88mm aspect (0.7159), enough resolution
// for pHash, the identifier strip, and Tier 3 crops.
export const CARD_W = 512;
export const CARD_H = 716;

/**
 * Solve the 3×3 homography H mapping each `from[i]` to `to[i]` (4 point pairs),
 * returned row-major with h22 = 1. Gaussian elimination with partial pivoting
 * on the standard 8×8 DLT system.
 */
export function solveHomography(from: Point[], to: Point[]): number[] {
  if (from.length !== 4 || to.length !== 4) {
    throw new Error("solveHomography requires exactly 4 point pairs");
  }

  // Build A·h = b for h = [h00..h21]
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }

  // Gaussian elimination with partial pivoting
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) {
      throw new Error("Degenerate point configuration for homography");
    }
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      for (let k = col; k < n; k++) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }
  const h = new Array<number>(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * h[k];
    h[row] = sum / a[row][row];
  }

  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Apply a row-major 3×3 homography to a point. */
export function applyHomography(h: number[], p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/**
 * Order 4 arbitrary points as [top-left, top-right, bottom-right, bottom-left]
 * by angle around the centroid.
 */
export function orderCorners(pts: Point[]): [Point, Point, Point, Point] {
  if (pts.length !== 4) throw new Error("orderCorners requires 4 points");
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  // Sort counter... clockwise in screen coords (y down): TL, TR, BR, BL
  const sorted = [...pts].sort(
    (p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx)
  );
  // atan2 order starting at -π gives: TL(-3π/4), TR(-π/4), BR(π/4), BL(3π/4)
  return [sorted[0], sorted[1], sorted[2], sorted[3]];
}

/**
 * Warp the quad `corners` (TL,TR,BR,BL in source image coords) to an
 * axis-aligned outW×outH image via inverse mapping + bilinear sampling.
 */
export function warpPerspective(
  img: RawImage,
  corners: [Point, Point, Point, Point],
  outW: number = CARD_W,
  outH: number = CARD_H
): RawImage {
  // Inverse map: destination corners → source corners
  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];
  const h = solveHomography(dst, corners);

  const out = new Uint8ClampedArray(outW * outH * 4);
  const { width, height, data } = img;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const w = h[6] * x + h[7] * y + h[8];
      const sx = (h[0] * x + h[1] * y + h[2]) / w;
      const sy = (h[3] * x + h[4] * y + h[5]) / w;

      const p = (y * outW + x) * 4;
      if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1) {
        out[p + 3] = 255; // outside: opaque black
        continue;
      }

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;

      const p00 = (y0 * width + x0) * 4;
      const p10 = (y0 * width + x1) * 4;
      const p01 = (y1 * width + x0) * 4;
      const p11 = (y1 * width + x1) * 4;

      for (let c = 0; c < 3; c++) {
        const top = data[p00 + c] * (1 - fx) + data[p10 + c] * fx;
        const bot = data[p01 + c] * (1 - fx) + data[p11 + c] * fx;
        out[p + c] = top * (1 - fy) + bot * fy;
      }
      out[p + 3] = 255;
    }
  }

  return { width: outW, height: outH, data: out };
}
