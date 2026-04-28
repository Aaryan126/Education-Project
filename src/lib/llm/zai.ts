import OpenAI from "openai";
import { getEnv, requireTutorProviderKeys } from "@/lib/env";
import { normalizeConfidence } from "@/lib/modelOutput";
import { buildTutorSystemPrompt, buildTutorUserPrompt, parseTutorJson } from "@/lib/tutor/prompt";
import type { TutorRequest, TutorResponse } from "@/lib/tutor/types";
import type { LLMProvider } from "./types";

export class ZaiTutorProvider implements LLMProvider {
  readonly name = "zai";

  async generateTutorResponse(input: TutorRequest): Promise<TutorResponse> {
    const env = getEnv();
    requireTutorProviderKeys(env);

    const client = new OpenAI({
      apiKey: env.ZAI_API_KEY,
      baseURL: env.ZAI_BASE_URL
    });

    const response = await client.chat.completions.create({
      model: env.ZAI_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildTutorSystemPrompt(input)
        },
        {
          role: "user",
          content: buildTutorUserPrompt(input)
        }
      ]
    });

    const text = response.choices[0]?.message.content ?? "";
    const parsed = parseTutorJson(text);

    return {
      response: String(parsed.response ?? ""),
      followUpQuestion: String(parsed.followUpQuestion ?? ""),
      understandingLevel: parsed.understandingLevel === "low" || parsed.understandingLevel === "high" ? parsed.understandingLevel : "medium",
      directAnswerGiven: Boolean(parsed.directAnswerGiven),
      confidence: normalizeConfidence(parsed.confidence),
      provider: this.name
    };
  }
}
