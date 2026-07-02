export interface OcrProvider {
  name: string;
  /**
   * Extract raw text from a base64 JPEG. Returns null on any failure —
   * Tier 2 must fall through silently, never break the waterfall.
   */
  readText(imageBase64: string): Promise<string | null>;
}
