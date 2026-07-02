import { GoogleVisionOcr } from "./google-vision";
import type { OcrProvider } from "./types";

export type { OcrProvider } from "./types";
export { GoogleVisionOcr } from "./google-vision";

/**
 * Returns the configured OCR provider, or null when none is configured —
 * in which case the waterfall skips Tier 2 entirely.
 */
export function getOcrProvider(): OcrProvider | null {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return null;
  return new GoogleVisionOcr(apiKey);
}
