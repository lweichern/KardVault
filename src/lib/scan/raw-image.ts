// Canvas-free image primitives. RawImage is a structural subset of ImageData
// so the same math runs on browser ImageData, server buffers, and test fixtures.

export interface RawImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, 4 bytes per pixel
}

/** Rec. 601 luma, one Float64 per pixel. */
export function toGrayscale(img: RawImage): Float64Array {
  const { width, height, data } = img;
  const gray = new Float64Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return gray;
}

/**
 * Area-average downsample of a grayscale buffer. Box-filter is enough for
 * pHash (which immediately DCTs) and for detection downscaling.
 */
export function resampleGray(
  gray: Float64Array,
  w: number,
  h: number,
  outW: number,
  outH: number
): Float64Array {
  const out = new Float64Array(outW * outH);
  const xRatio = w / outW;
  const yRatio = h / outH;

  for (let oy = 0; oy < outH; oy++) {
    const y0 = Math.floor(oy * yRatio);
    const y1 = Math.min(h, Math.max(y0 + 1, Math.floor((oy + 1) * yRatio)));
    for (let ox = 0; ox < outW; ox++) {
      const x0 = Math.floor(ox * xRatio);
      const x1 = Math.min(w, Math.max(x0 + 1, Math.floor((ox + 1) * xRatio)));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += gray[y * w + x];
          count++;
        }
      }
      out[oy * outW + ox] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/** Axis-aligned crop, clamped to image bounds. */
export function cropRaw(img: RawImage, x: number, y: number, w: number, h: number): RawImage {
  const x0 = Math.max(0, Math.min(img.width, Math.round(x)));
  const y0 = Math.max(0, Math.min(img.height, Math.round(y)));
  const cw = Math.max(1, Math.min(img.width - x0, Math.round(w)));
  const ch = Math.max(1, Math.min(img.height - y0, Math.round(h)));

  const data = new Uint8ClampedArray(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    const srcStart = ((y0 + row) * img.width + x0) * 4;
    data.set(img.data.subarray(srcStart, srcStart + cw * 4), row * cw * 4);
  }
  return { width: cw, height: ch, data };
}

/** Crop by fractional region of the image (0..1 coordinates). */
export function cropFraction(
  img: RawImage,
  fx: number,
  fy: number,
  fw: number,
  fh: number
): RawImage {
  return cropRaw(img, fx * img.width, fy * img.height, fw * img.width, fh * img.height);
}
