// 64-bit perceptual hash (pHash): 32×32 grayscale → 2D DCT-II → top-left 8×8
// low-frequency block (DC excluded) → median threshold → 64-bit hex string.
// Tier 1 of the identification waterfall (CLAUDE-enhance.md §2).

import type { RawImage } from "./raw-image";
import { toGrayscale, resampleGray } from "./raw-image";

const SIZE = 32;
const BLOCK = 8;

// Precomputed DCT cosine table: cos[(2x+1) * u * π / (2N)]
const COS = new Float64Array(SIZE * SIZE);
for (let u = 0; u < SIZE; u++) {
  for (let x = 0; x < SIZE; x++) {
    COS[u * SIZE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE));
  }
}

/** 2D DCT-II of a SIZE×SIZE buffer, returning only the BLOCK×BLOCK low-freq corner. */
function dctLowFreq(pixels: Float64Array): Float64Array {
  // Separable: rows first, then columns (only the BLOCK columns we need).
  const rows = new Float64Array(SIZE * BLOCK);
  for (let y = 0; y < SIZE; y++) {
    for (let u = 0; u < BLOCK; u++) {
      let sum = 0;
      for (let x = 0; x < SIZE; x++) {
        sum += pixels[y * SIZE + x] * COS[u * SIZE + x];
      }
      rows[y * BLOCK + u] = sum;
    }
  }
  const out = new Float64Array(BLOCK * BLOCK);
  for (let v = 0; v < BLOCK; v++) {
    for (let u = 0; u < BLOCK; u++) {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) {
        sum += rows[y * BLOCK + u] * COS[v * SIZE + y];
      }
      out[v * BLOCK + u] = sum;
    }
  }
  return out;
}

/** Perceptual hash of an image as 16 lowercase hex chars (64 bits). */
export function phash(img: RawImage): string {
  const gray = toGrayscale(img);
  const small = resampleGray(gray, img.width, img.height, SIZE, SIZE);
  const dct = dctLowFreq(small);

  // Median of the 8×8 block excluding the DC term [0,0]
  const acs: number[] = [];
  for (let i = 1; i < dct.length; i++) acs.push(dct[i]);
  const sorted = [...acs].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  // Bit i = 1 when coefficient > median. DC bit is always 0 (coefficient skipped).
  let hex = "";
  for (let nibble = 0; nibble < 16; nibble++) {
    let value = 0;
    for (let bit = 0; bit < 4; bit++) {
      const i = nibble * 4 + bit;
      const above = i === 0 ? false : dct[i] > median;
      value = (value << 1) | (above ? 1 : 0);
    }
    hex += value.toString(16);
  }
  return hex;
}

const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];
}

/** Hamming distance between two 16-hex-char hashes (0..64). */
export function hammingHex(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) {
    throw new Error(`hammingHex expects 16-char hex hashes, got "${a}" / "${b}"`);
  }
  let dist = 0;
  for (let i = 0; i < 16; i += 2) {
    const byteA = parseInt(a.slice(i, i + 2), 16);
    const byteB = parseInt(b.slice(i, i + 2), 16);
    dist += POPCOUNT[byteA ^ byteB];
  }
  return dist;
}

export function isValidHash(h: unknown): h is string {
  return typeof h === "string" && /^[0-9a-f]{16}$/.test(h);
}
