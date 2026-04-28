import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { getEnv, requireTutorProviderKeys } from "@/lib/env";
import { normalizeConfidence } from "@/lib/modelOutput";
import { buildTutorSystemPrompt, buildTutorUserPrompt, parseTutorJson } from "@/lib/tutor/prompt";
import type { TutorRequest, TutorResponse } from "@/lib/tutor/types";
import type { LLMProvider } from "./types";

const tutorResponseTool: Tool = {
  name: "return_tutor_response",
  description: "Return the structured Socratic tutor response for the learner.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      response: {
        type: "string",
        description: "Spoken-friendly tutor response in the preferred tutoring language."
      },
      followUpQuestion: {
        type: "string",
        description: "Exactly one concise question for the learner."
      },
      understandingLevel: {
        type: "string",
        enum: ["low", "medium", "high"]
      },
      directAnswerGiven: {
        type: "boolean"
      },
      confidence: {
        type: "number"
      }
    },
    required: ["response", "followUpQuestion", "understandingLevel", "directAnswerGiven", "confidence"]
  }
};

export class AnthropicTutorProvider implements LLMProvider {
  readonly name = "anthropic";

  async generateTutorResponse(input: TutorRequest): Promise<TutorResponse> {
    const env = getEnv();
    requireTutorProviderKeys(env);

    const client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY
    });

    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 900,
      temperature: 0.4,
      system: buildTutorSystemPrompt(input),
      tools: [tutorResponseTool],
      tool_choice: {
        type: "tool",
        name: "return_tutor_response",
        disable_parallel_tool_use: true
      },
      messages: [
        {
          role: "user",
          content: buildTutorUserPrompt(input)
        }
      ]
    });

    const toolUse = response.content.find(
      (block) => block.type === "tool_use" && block.name === "return_tutor_response"
    );

    if (toolUse?.type === "tool_use") {
      const parsed = toolUse.input as Record<string, unknown>;

      return {
        response: String(parsed.response ?? ""),
        followUpQuestion: String(parsed.followUpQuestion ?? ""),
        understandingLevel: parsed.understandingLevel === "low" || parsed.understandingLevel === "high" ? parsed.understandingLevel : "medium",
        directAnswerGiven: Boolean(parsed.directAnswerGiven),
        confidence: normalizeConfidence(parsed.confidence),
        provider: this.name
      };
    }

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

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
