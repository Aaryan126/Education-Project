import { getEnv } from "@/lib/env";
import { AnthropicTutorProvider } from "./anthropic";
import type { LLMProvider } from "./types";
import { ZaiTutorProvider } from "./zai";

export function getTutorProvider(): LLMProvider {
  const env = getEnv();

  if (env.LLM_PROVIDER === "zai") {
    return new ZaiTutorProvider();
  }

  return new AnthropicTutorProvider();
}
