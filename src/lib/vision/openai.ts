import OpenAI from "openai";
import { SINGLE_CARD_PROMPT } from "./prompts";
import type { VisionProvider, ScanResult } from "./types";

export class OpenAIProvider implements VisionProvider {
  name = "gpt-4o-mini";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async identify(imageBase64: string): Promise<ScanResult> {
    const response = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: SINGLE_CARD_PROMPT,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "";
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(cleaned) as ScanResult;
  }
}
