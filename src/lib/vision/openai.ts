import OpenAI from "openai";
import { EXTRACTION_PROMPT } from "./prompts";
import { parseExtractionJson } from "./parse";
import type { VisionProvider, ExtractionResult } from "./types";

export class OpenAIProvider implements VisionProvider {
  name = "gpt-4o-mini";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async extract(imagesBase64: string[]): Promise<ExtractionResult> {
    const response = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_PROMPT },
            ...imagesBase64.map((data) => ({
              type: "image_url" as const,
              image_url: { url: `data:image/jpeg;base64,${data}` },
            })),
          ],
        },
      ],
    });

    return parseExtractionJson(response.choices[0]?.message?.content ?? "");
  }
}
