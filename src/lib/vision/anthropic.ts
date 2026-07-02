import Anthropic from "@anthropic-ai/sdk";
import { EXTRACTION_PROMPT } from "./prompts";
import { parseExtractionJson } from "./parse";
import type { VisionProvider, ExtractionResult } from "./types";

export class AnthropicProvider implements VisionProvider {
  name = "claude-haiku-4.5";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extract(imagesBase64: string[]): Promise<ExtractionResult> {
    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            ...imagesBase64.map((data) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/jpeg" as const,
                data,
              },
            })),
            { type: "text" as const, text: EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
    return parseExtractionJson(text);
  }
}
