import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getEnv, requireTutorProviderKeys } from "@/lib/env";
import { normalizeConfidence } from "@/lib/modelOutput";
import type { LearningCheckEvaluation, LearningCheckStatus, LearningContext } from "@/lib/tutor/types";

type EvaluateLearningCheckInput = {
  learningContext?: LearningContext | null;
  retrievalQuestion: string;
  learnerAnswer: string;
  targetLanguage: string;
};

type RawEvaluation = {
  status?: unknown;
  concept?: unknown;
  feedback?: unknown;
  confidence?: unknown;
};

function formatLearningContext(learningContext?: LearningContext | null) {
  if (!learningContext) {
    return "No learning context is available.";
  }

  return [
    `Topic: ${learningContext.topic}`,
    `Summary: ${learningContext.summary}`,
    `Extracted text:\n${learningContext.extractedText.slice(0, 6000)}`
  ].join("\n\n");
}

function buildEvaluationSystemPrompt(input: EvaluateLearningCheckInput) {
  return `
You evaluate a learner's answer to one retrieval-practice question.

Use the source context and question to decide how well the learner answered.
Base progress only on the learner's actual answer, not on the tutor's previous estimate.

Status rules:
- "got-it": The answer is mostly correct and shows the core idea.
- "needs-practice": The answer is partially correct, vague, missing an important part, or has a minor misconception.
- "confused": The answer is blank, unrelated, mostly incorrect, or the learner says they do not know.

Return only valid JSON:
{
  "status": "got-it | needs-practice | confused",
  "concept": "2 to 5 word concept label",
  "feedback": "one short actionable sentence in ${input.targetLanguage}",
  "confidence": 0.0
}
`.trim();
}

function buildEvaluationUserPrompt(input: EvaluateLearningCheckInput) {
  return `
Learning context:
${formatLearningContext(input.learningContext)}

Retrieval question:
${input.retrievalQuestion}

Learner answer:
${input.learnerAnswer}
`.trim();
}

function parseEvaluationJson(raw: string): RawEvaluation {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1) {
    return {};
  }

  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as RawEvaluation;
  } catch {
    return {};
  }
}

function normalizeStatus(value: unknown): LearningCheckStatus {
  if (value === "got-it" || value === "needs-practice" || value === "confused") {
    return value;
  }

  return "needs-practice";
}

function normalizeEvaluation(raw: RawEvaluation, provider: string, fallbackConcept: string): LearningCheckEvaluation {
  const status = normalizeStatus(raw.status);
  const concept = typeof raw.concept === "string" && raw.concept.trim() ? raw.concept.trim() : fallbackConcept;
  const feedback =
    typeof raw.feedback === "string" && raw.feedback.trim()
      ? raw.feedback.trim()
      : status === "got-it"
        ? "That answer shows the main idea."
        : "Review this idea once more and try another short answer.";

  return {
    status,
    concept,
    feedback,
    confidence: normalizeConfidence(raw.confidence, 0.65),
    provider
  };
}

export async function evaluateLearningCheck(input: EvaluateLearningCheckInput): Promise<LearningCheckEvaluation> {
  const env = getEnv();
  requireTutorProviderKeys(env);
  const fallbackConcept = input.learningContext?.topic || "Current concept";

  if (env.LLM_PROVIDER === "zai") {
    const client = new OpenAI({
      apiKey: env.ZAI_API_KEY,
      baseURL: env.ZAI_BASE_URL
    });

    const response = await client.chat.completions.create({
      model: env.ZAI_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildEvaluationSystemPrompt(input)
        },
        {
          role: "user",
          content: buildEvaluationUserPrompt(input)
        }
      ]
    });

    return normalizeEvaluation(parseEvaluationJson(response.choices[0]?.message.content ?? ""), "zai", fallbackConcept);
  }

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY
  });

  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 450,
    temperature: 0.1,
    system: buildEvaluationSystemPrompt(input),
    messages: [
      {
        role: "user",
        content: buildEvaluationUserPrompt(input)
      }
    ]
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  return normalizeEvaluation(parseEvaluationJson(text), "anthropic", fallbackConcept);
}
