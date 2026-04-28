import type { LearningContext, TutorRequest } from "./types";
import { normalizeConfidence } from "@/lib/modelOutput";

function formatLearningContext(learningContext?: LearningContext | null) {
  if (!learningContext) {
    return "No page image has been processed yet. Ask the learner to capture a page if the question depends on source material.";
  }

  return [
    `Detected language: ${learningContext.detectedLanguage}`,
    `Topic: ${learningContext.topic}`,
    `Summary: ${learningContext.summary}`,
    `Diagram/layout notes: ${learningContext.diagramNotes || "None"}`,
    `Extracted text:\n${learningContext.extractedText}`
  ].join("\n\n");
}

export function buildTutorSystemPrompt(input: TutorRequest) {
  return `
You are AI Learning Companion, a patient Socratic tutor for learners who may struggle with reading or studying in a non-native language.

Primary behavior rules:
- Teach thinking, not just answers.
- Give hints and guiding questions before revealing an answer.
- Ask exactly one focused follow-up question at the end.
- Use short, spoken-friendly sentences.
- Adapt to the learner's understanding level: ${input.understandingLevel}.
- The preferred tutoring language is ${input.targetLanguage}.
- The source language is ${input.sourceLanguage}.
- If the learner explicitly asks for the final answer, you may provide it, but briefly explain the reasoning.
- If the learner does not ask for the final answer, do not solve the whole problem for them.
- If the learner seems confused, simplify and use a smaller step.

Learning context:
${formatLearningContext(input.learningContext)}

Return only valid JSON with this shape:
{
  "response": "spoken-friendly tutor response in the preferred tutoring language",
  "followUpQuestion": "one concise question for the learner",
  "understandingLevel": "low | medium | high",
  "directAnswerGiven": false,
  "confidence": 0.0
}

Do not include markdown fences. Escape all quotation marks inside JSON string values.
`.trim();
}

export function buildTutorUserPrompt(input: TutorRequest) {
  const recentMessages = input.messages
    .slice(-8)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return `
Recent conversation:
${recentMessages || "No previous conversation."}

Learner's latest message:
${input.userMessage}

Direct-answer permission from app state: ${input.allowDirectAnswer ? "allowed" : "not allowed unless the learner explicitly requested it"}.
`.trim();
}

export function parseTutorJson(raw: string) {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1) {
    return {
      response: trimmed,
      followUpQuestion: "",
      understandingLevel: "medium",
      directAnswerGiven: false,
      confidence: 0.5
    };
  }

  const jsonCandidate = trimmed.slice(jsonStart, jsonEnd + 1);

  try {
    return JSON.parse(jsonCandidate);
  } catch {
    const response = extractJsonishString(jsonCandidate, "response", "followUpQuestion");
    const followUpQuestion = extractJsonishString(jsonCandidate, "followUpQuestion", "understandingLevel");
    const understandingLevel = extractJsonishString(jsonCandidate, "understandingLevel", "directAnswerGiven");
    const directAnswerGiven = /"directAnswerGiven"\s*:\s*true/.test(jsonCandidate);
    const confidence = extractJsonishScalar(jsonCandidate, "confidence");

    return {
      response: response || trimmed,
      followUpQuestion: followUpQuestion || "",
      understandingLevel: understandingLevel === "low" || understandingLevel === "high" ? understandingLevel : "medium",
      directAnswerGiven,
      confidence: normalizeConfidence(confidence, 0.5)
    };
  }
}

function extractJsonishString(raw: string, fieldName: string, nextFieldName: string) {
  const pattern = new RegExp(`"${fieldName}"\\s*:\\s*"([\\s\\S]*?)",\\s*"${nextFieldName}"`);
  const match = raw.match(pattern);
  return match?.[1]?.trim().replace(/\\"/g, "\"");
}

function extractJsonishScalar(raw: string, fieldName: string) {
  const pattern = new RegExp(`"${fieldName}"\\s*:\\s*([^,}\\n]+)`);
  const match = raw.match(pattern);
  return match?.[1]?.trim().replace(/^"|"$/g, "");
}
