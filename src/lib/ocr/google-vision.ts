// Tier 2 OCR: Google Cloud Vision TEXT_DETECTION on the identifier strip
// (CLAUDE-enhance.md §2 Tier 2). Cheap, fast, and only ever sees a small
// high-resolution crop — never the whole photo.

import type { OcrProvider } from "./types";

const ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
const TIMEOUT_MS = 3000;

interface AnnotateResponse {
  responses?: Array<{
    fullTextAnnotation?: { text?: string };
    textAnnotations?: Array<{ description?: string }>;
    error?: { message?: string };
  }>;
}

export class GoogleVisionOcr implements OcrProvider {
  name = "google-cloud-vision";

  constructor(private apiKey: string) {}

  async readText(imageBase64: string): Promise<string | null> {
    try {
      const res = await fetch(`${ENDPOINT}?key=${this.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: imageBase64 },
              features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
            },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!res.ok) {
        console.error(`[ocr] Google Vision HTTP ${res.status}`);
        return null;
      }

      const json = (await res.json()) as AnnotateResponse;
      const first = json.responses?.[0];
      if (!first || first.error) {
        if (first?.error) console.error("[ocr] Google Vision error:", first.error.message);
        return null;
      }
      return (
        first.fullTextAnnotation?.text ??
        first.textAnnotations?.[0]?.description ??
        null
      );
    } catch (err) {
      console.error("[ocr] Google Vision request failed:", err);
      return null;
    }
  }
}
