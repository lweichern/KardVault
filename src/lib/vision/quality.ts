import type { QualityResult } from "./types";

export function checkPhotoQuality(imageData: ImageData): QualityResult {
  const { width, height, data } = imageData;

  // Check 1: Resolution
  if (width < 480 || height < 480) {
    return {
      ok: false,
      reason: `Image resolution too low (${width}×${height}). Minimum 480×480 required.`,
    };
  }

  // Check 2: Brightness
  let brightnessSum = 0;
  const pixelCount = width * height;
  for (let i = 0; i < data.length; i += 4) {
    brightnessSum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  const avgBrightness = brightnessSum / pixelCount;

  if (avgBrightness < 40) {
    return { ok: false, reason: "Image is too dark. Please improve lighting and try again." };
  }
  if (avgBrightness > 240) {
    return { ok: false, reason: "Image is too bright. Reduce glare or move away from direct light." };
  }

  // Check 3: Blur detection via Laplacian variance approximation
  const step = 4;
  let laplacianSumSq = 0;
  let sampleCount = 0;

  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const idx = (y * width + x) * 4;
      const center = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;

      const upIdx = ((y - step) * width + x) * 4;
      const up = (data[upIdx] + data[upIdx + 1] + data[upIdx + 2]) / 3;

      const downIdx = ((y + step) * width + x) * 4;
      const down = (data[downIdx] + data[downIdx + 1] + data[downIdx + 2]) / 3;

      const leftIdx = (y * width + (x - step)) * 4;
      const left = (data[leftIdx] + data[leftIdx + 1] + data[leftIdx + 2]) / 3;

      const rightIdx = (y * width + (x + step)) * 4;
      const right = (data[rightIdx] + data[rightIdx + 1] + data[rightIdx + 2]) / 3;

      const laplacian = up + down + left + right - 4 * center;
      laplacianSumSq += laplacian * laplacian;
      sampleCount++;
    }
  }

  const laplacianVariance = Math.sqrt(laplacianSumSq / sampleCount);

  if (laplacianVariance < 50) {
    return { ok: false, reason: "Image appears blurry. Please hold the camera steady and try again." };
  }

  return { ok: true };
}
