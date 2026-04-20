import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import type { VisionProvider } from "./types";

export function getVisionProvider(): VisionProvider {
  const providerName = process.env.VISION_PROVIDER ?? "gemini";

  switch (providerName) {
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable is required for the gemini provider");
      }
      return new GeminiProvider(apiKey);
    }
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY environment variable is required for the openai provider");
      }
      return new OpenAIProvider(apiKey);
    }
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY environment variable is required for the anthropic provider");
      }
      return new AnthropicProvider(apiKey);
    }
    default:
      throw new Error(`Unknown VISION_PROVIDER: "${providerName}". Must be one of: gemini, openai, anthropic`);
  }
}
