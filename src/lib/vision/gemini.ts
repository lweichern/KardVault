import { GoogleGenerativeAI } from "@google/generative-ai";
import { EXTRACTION_PROMPT } from "./prompts";
import { parseExtractionJson } from "./parse";
import type { VisionProvider, ExtractionResult } from "./types";

export class GeminiProvider implements VisionProvider {
  name = "gemini-2.5-flash";
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async extract(imagesBase64: string[]): Promise<ExtractionResult> {
    const model = this.client.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    const result = await model.generateContent([
      EXTRACTION_PROMPT,
      ...imagesBase64.map((data) => ({
        inlineData: { mimeType: "image/jpeg", data },
      })),
    ]);

    return parseExtractionJson(result.response.text());
  }
}
