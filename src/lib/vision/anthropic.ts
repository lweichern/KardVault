import Anthropic from "@anthropic-ai/sdk";
import { SINGLE_CARD_PROMPT } from "./prompts";
import type { VisionProvider, ScanResult } from "./types";

export class AnthropicProvider implements VisionProvider {
  name = "claude-haiku-4.5";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async identify(imageBase64: string): Promise<ScanResult> {
    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: SINGLE_CARD_PROMPT,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(cleaned) as ScanResult;
  }
}
