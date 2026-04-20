import { GoogleGenerativeAI } from "@google/generative-ai";
import { SINGLE_CARD_PROMPT } from "./prompts";
import type { VisionProvider, ScanResult } from "./types";

export class GeminiProvider implements VisionProvider {
  name = "gemini-2.5-flash";
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async identify(imageBase64: string): Promise<ScanResult> {
    const model = this.client.getGenerativeModel({
      model: "gemini-2.5-flash-preview-04-17",
    });

    const result = await model.generateContent([
      SINGLE_CARD_PROMPT,
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64,
        },
      },
    ]);

    const text = result.response.text();
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(cleaned) as ScanResult;
  }
}
