// Flat-lay sealed-product detection via Gemini bounding boxes
// (CLAUDE-enhance.md §5 flow 2b). One vision call returns every product with
// a normalized box + name guess; deterministic catalog matching happens in
// match.ts — the model never decides prices or final identity.

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GenerationConfig } from "@google/generative-ai";

export interface DetectedItem {
  /** Normalized 0..1 box in image coordinates. */
  box: { x: number; y: number; w: number; h: number };
  label: string;
}

export const DETECT_PROMPT = `Detect every sealed Pokémon TCG product in this photo (booster boxes, booster bundles, Elite Trainer Boxes, tins, collection boxes, blister packs, single booster packs). Ignore single loose cards and non-Pokémon items.
Return ONLY a JSON array, no markdown. Each element:
{"box_2d": [ymin, xmin, ymax, xmax], "label": "<set name + product type + language if visible>"}
- box_2d coordinates are integers normalized to 0-1000.
- label example: "Surging Sparks Elite Trainer Box" or "Japanese Terastal Festival Booster Box".
- Include EVERY distinct product. If two identical products sit side by side, return a box for each.
- If nothing is detected, return [].`;

const GENERATION_CONFIG = {
  temperature: 0,
  maxOutputTokens: 2000,
  thinkingConfig: { thinkingBudget: 0 },
} as GenerationConfig;

/** Parse the model's box_2d JSON into normalized boxes. Exported for tests. */
export function parseDetection(text: string): DetectedItem[] {
  let cleaned = text.replace(/```(?:json)?/gi, "").trim();
  if (!cleaned.startsWith("[")) {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end <= start) return [];
    cleaned = cleaned.slice(start, end + 1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const items: DetectedItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as { box_2d?: unknown; label?: unknown };
    if (!Array.isArray(e.box_2d) || e.box_2d.length !== 4) continue;
    const nums = e.box_2d.map(Number);
    if (nums.some((n) => !isFinite(n))) continue;
    const [ymin, xmin, ymax, xmax] = nums.map((n) => Math.max(0, Math.min(1000, n)));
    if (ymax <= ymin || xmax <= xmin) continue;
    items.push({
      box: {
        x: xmin / 1000,
        y: ymin / 1000,
        w: (xmax - xmin) / 1000,
        h: (ymax - ymin) / 1000,
      },
      label: typeof e.label === "string" ? e.label : "",
    });
  }
  return items;
}

export async function detectSealedProducts(
  imageBase64: string,
  apiKey: string
): Promise<DetectedItem[]> {
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: GENERATION_CONFIG,
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await model.generateContent([
        DETECT_PROMPT,
        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
      ]);
      return parseDetection(result.response.text());
    } catch (err) {
      lastError = err;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 600));
    }
  }
  throw lastError;
}
