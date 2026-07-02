// Card boundary detection + capture quality gates (CLAUDE-enhance.md §3).
// Pure TS: Sobel edges + per-side line fitting + intersection. When detection
// fails the caller falls back to the framing-guide rectangle — the vendor
// aligned the card, so the guide is already a good quad.

import type { RawImage } from "./raw-image";
import { toGrayscale, resampleGray } from "./raw-image";
import type { Point } from "./geometry";
import { orderCorners } from "./geometry";

export interface QuadResult {
  corners: [Point, Point, Point, Point]; // TL, TR, BR, BL in source coords
  score: number; // 0..1 fraction of scanlines with edge support
}

// Spec §3 starting thresholds — tune with scan_events telemetry.
export const BLUR_MIN = 100; // variance of Laplacian on the warped crop
export const GLARE_MAX = 0.18; // fraction of blown pixels tolerated on the strip

const DETECT_W = 320;
const MIN_AREA_FRACTION = 0.25;
const MIN_ASPECT = 0.5; // w/h — cards are ~0.716; allow perspective slack
const MAX_ASPECT = 1.0;
const MIN_SIDE_SUPPORT = 0.5; // fraction of scanlines that must find an edge
const MIN_EDGE_MAG = 30; // Sobel noise floor — below this there is no real edge

/** Sobel gradient magnitude of a grayscale buffer. */
function sobelMagnitude(gray: Float64Array, w: number, h: number): Float64Array {
  const mag = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] + gray[i - w + 1] -
        2 * gray[i - 1] + 2 * gray[i + 1] -
        gray[i + w - 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      mag[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return mag;
}

/** Otsu threshold over a Float64 buffer (values binned 0..255 after scaling). */
function otsuThreshold(values: Float64Array): number {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (max === 0) return Infinity;

  const bins = 256;
  const hist = new Float64Array(bins);
  for (const v of values) {
    hist[Math.min(bins - 1, Math.floor((v / max) * (bins - 1)))]++;
  }
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let bestVar = 0;
  let bestT = 0;
  for (let t = 0; t < bins; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      bestT = t;
    }
  }
  return (bestT / (bins - 1)) * max;
}

interface FittedLine {
  // Near-vertical sides: x = a*y + b. Near-horizontal: y = a*x + b.
  a: number;
  b: number;
  support: number; // fraction of scanlines that contributed
}

/**
 * Fit a boundary line by scanning inward from one side. `vertical` = fitting a
 * near-vertical line (left/right sides, scan along x per row).
 */
function fitSide(
  mag: Float64Array,
  w: number,
  h: number,
  threshold: number,
  side: "left" | "right" | "top" | "bottom"
): FittedLine | null {
  const vertical = side === "left" || side === "right";
  const scanCount = vertical ? h : w;
  const lo = Math.floor(scanCount * 0.12);
  const hi = Math.ceil(scanCount * 0.88);

  const pts: Point[] = [];
  for (let s = lo; s < hi; s += 2) {
    const limit = vertical ? w : h;
    const maxDepth = Math.floor(limit * 0.48);
    let found = -1;
    for (let d = 1; d < maxDepth; d++) {
      const pos =
        side === "left" ? d :
        side === "right" ? limit - 1 - d :
        side === "top" ? d :
        limit - 1 - d;
      const idx = vertical ? s * w + pos : pos * w + s;
      if (mag[idx] > threshold) {
        found = pos;
        break;
      }
    }
    if (found >= 0) {
      pts.push(vertical ? { x: found, y: s } : { x: s, y: found });
    }
  }

  const support = pts.length / Math.max(1, Math.floor((hi - lo) / 2));
  if (support < MIN_SIDE_SUPPORT) return null;

  const ind = (p: Point) => (vertical ? p.y : p.x);
  const dep = (p: Point) => (vertical ? p.x : p.y);

  // Robust initial fit via Theil–Sen: scanlines near the corners hit the
  // perpendicular edges and contaminate up to ~25% of points, which wrecks a
  // plain least-squares fit. Median-of-slopes shrugs that off.
  const theilSen = (points: Point[]): { a: number; b: number } | null => {
    const n = points.length;
    if (n < 3) return null;
    const slopes: number[] = [];
    const stride = Math.max(1, Math.floor((n * (n - 1)) / 2 / 2000)); // cap pair count
    let pair = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (pair++ % stride !== 0) continue;
        const di = ind(points[j]) - ind(points[i]);
        if (Math.abs(di) < 1e-9) continue;
        slopes.push((dep(points[j]) - dep(points[i])) / di);
      }
    }
    if (slopes.length === 0) return null;
    slopes.sort((x, y) => x - y);
    const a = slopes[Math.floor(slopes.length / 2)];
    const intercepts = points.map((p) => dep(p) - a * ind(p)).sort((x, y) => x - y);
    const b = intercepts[Math.floor(intercepts.length / 2)];
    return { a, b };
  };

  const leastSquares = (points: Point[]): { a: number; b: number } | null => {
    const n = points.length;
    if (n < 3) return null;
    let si = 0, sd = 0, sii = 0, sid = 0;
    for (const p of points) {
      si += ind(p);
      sd += dep(p);
      sii += ind(p) * ind(p);
      sid += ind(p) * dep(p);
    }
    const denom = n * sii - si * si;
    if (Math.abs(denom) < 1e-9) return null;
    const a = (n * sid - si * sd) / denom;
    return { a, b: (sd - a * si) / n };
  };

  let line = theilSen(pts);
  if (!line) return null;

  const inliers = pts.filter((p) => Math.abs(line!.a * ind(p) + line!.b - dep(p)) <= 3);
  if (inliers.length < pts.length * 0.5) return null;
  line = leastSquares(inliers) ?? line;

  return { a: line.a, b: line.b, support };
}

/** Intersect a near-vertical line (x=a1*y+b1) with a near-horizontal one (y=a2*x+b2). */
function intersect(v: FittedLine, hLine: FittedLine): Point | null {
  const denom = 1 - v.a * hLine.a;
  if (Math.abs(denom) < 1e-9) return null;
  const x = (v.a * hLine.b + v.b) / denom;
  const y = hLine.a * x + hLine.b;
  return { x, y };
}

function polygonArea(c: Point[]): number {
  let area = 0;
  for (let i = 0; i < c.length; i++) {
    const j = (i + 1) % c.length;
    area += c[i].x * c[j].y - c[j].x * c[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Detect the dominant card-shaped quad in a frame. Returns corners in the
 * ORIGINAL image's coordinate space, or null when no confident quad exists.
 */
export function detectCardQuad(img: RawImage): QuadResult | null {
  const scale = Math.min(1, DETECT_W / img.width);
  const dw = Math.max(32, Math.round(img.width * scale));
  const dh = Math.max(32, Math.round(img.height * scale));

  const gray = resampleGray(toGrayscale(img), img.width, img.height, dw, dh);
  const mag = sobelMagnitude(gray, dw, dh);
  let maxMag = 0;
  for (const v of mag) if (v > maxMag) maxMag = v;
  if (maxMag < MIN_EDGE_MAG * 3) return null; // featureless frame
  const threshold = Math.max(otsuThreshold(mag), MIN_EDGE_MAG);
  if (!isFinite(threshold)) return null;

  const left = fitSide(mag, dw, dh, threshold, "left");
  const right = fitSide(mag, dw, dh, threshold, "right");
  const top = fitSide(mag, dw, dh, threshold, "top");
  const bottom = fitSide(mag, dw, dh, threshold, "bottom");
  if (!left || !right || !top || !bottom) return null;

  const tl = intersect(left, top);
  const tr = intersect(right, top);
  const br = intersect(right, bottom);
  const bl = intersect(left, bottom);
  if (!tl || !tr || !br || !bl) return null;

  const corners = [tl, tr, br, bl];
  const margin = 4;
  for (const c of corners) {
    if (c.x < -margin || c.y < -margin || c.x > dw + margin || c.y > dh + margin) {
      return null;
    }
  }

  const area = polygonArea(corners);
  if (area < dw * dh * MIN_AREA_FRACTION) return null;

  const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const widthBot = Math.hypot(br.x - bl.x, br.y - bl.y);
  const heightL = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const heightR = Math.hypot(br.x - tr.x, br.y - tr.y);
  const aspect = ((widthTop + widthBot) / 2) / Math.max(1, (heightL + heightR) / 2);
  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) return null;

  const score = (left.support + right.support + top.support + bottom.support) / 4;
  const inv = 1 / scale;
  const scaled = corners.map((c) => ({ x: c.x * inv, y: c.y * inv }));
  return { corners: orderCorners(scaled), score: Math.min(1, score) };
}

/** Variance of the 4-neighbour Laplacian — standard sharpness metric. */
export function blurScore(img: RawImage): number {
  const gray = toGrayscale(img);
  const { width: w, height: h } = img;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Fraction of pixels that are blown-out highlights (luma > 250). */
export function glareScore(img: RawImage): number {
  const gray = toGrayscale(img);
  let blown = 0;
  for (const v of gray) if (v > 250) blown++;
  return blown / gray.length;
}
