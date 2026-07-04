import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GenerationConfig } from "@google/generative-ai";
import { EXTRACTION_PROMPT } from "./prompts";
import { parseExtractionJson } from "./parse";
import type { VisionProvider, ExtractionResult } from "./types";

// Dynamic thinking adds 5–15s per call and buys nothing for plain text
// extraction. thinkingConfig isn't in this SDK's types yet but passes
// through to the v1beta REST API.
const GENERATION_CONFIG = {
  temperature: 0,
  maxOutputTokens: 500,
  thinkingConfig: { thinkingBudget: 0 },
} as GenerationConfig;

const MAX_ATTEMPTS = 2; // free-tier Gemini 503s regularly — one retry is cheap

export class GeminiProvider implements VisionProvider {
  name = "gemini-2.5-flash";
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async extract(imagesBase64: string[]): Promise<ExtractionResult> {
    const model = this.client.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: GENERATION_CONFIG,
    });

    const parts = [
      EXTRACTION_PROMPT,
      ...imagesBase64.map((data) => ({
        inlineData: { mimeType: "image/jpeg", data },
      })),
    ];

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await model.generateContent(parts);
        return parseExtractionJson(result.response.text());
      } catch (err) {
        lastError = err;
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    }
    throw lastError;
  }
}
