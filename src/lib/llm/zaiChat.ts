import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { RuntimeEnv } from "@/lib/env";

type ZaiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ZaiJsonRequestInput = {
  temperature: number;
  maxTokens: number;
  messages: ZaiChatMessage[];
};

type ZaiChatCompletionRequest = ChatCompletionCreateParamsNonStreaming & {
  thinking?: {
    type: RuntimeEnv["ZAI_THINKING_TYPE"];
  };
};

export function createZaiClient(env: RuntimeEnv) {
  return new OpenAI({
    apiKey: env.ZAI_API_KEY,
    baseURL: env.ZAI_BASE_URL
  });
}

export function buildZaiJsonRequest(env: RuntimeEnv, input: ZaiJsonRequestInput): ZaiChatCompletionRequest {
  return {
    model: env.ZAI_MODEL,
    stream: false,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    response_format: { type: "json_object" },
    messages: input.messages,
    thinking: {
      type: env.ZAI_THINKING_TYPE
    }
  } as unknown as ZaiChatCompletionRequest;
}
