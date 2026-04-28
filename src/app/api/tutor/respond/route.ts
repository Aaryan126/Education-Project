import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getTutorProvider } from "@/lib/llm";

export const runtime = "nodejs";

const learningContextSchema = z
  .object({
    detectedLanguage: z.string(),
    extractedText: z.string(),
    topic: z.string(),
    summary: z.string(),
    diagramNotes: z.string(),
    suggestedQuestion: z.string(),
    confidence: z.number()
  })
  .nullable()
  .optional();

const messageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string()
});

const requestSchema = z.object({
  learningContext: learningContextSchema,
  messages: z.array(messageSchema).default([]),
  userMessage: z.string().min(1),
  targetLanguage: z.string().optional(),
  sourceLanguage: z.string().optional(),
  understandingLevel: z.enum(["low", "medium", "high"]).default("medium"),
  allowDirectAnswer: z.boolean().optional()
});

export async function POST(request: Request) {
  try {
    const env = getEnv();
    const body = requestSchema.parse(await request.json());
    const provider = getTutorProvider();

    const tutorResponse = await provider.generateTutorResponse({
      learningContext: body.learningContext,
      messages: body.messages,
      userMessage: body.userMessage,
      targetLanguage: body.targetLanguage || env.DEFAULT_TUTOR_LANGUAGE,
      sourceLanguage: body.sourceLanguage || env.DEFAULT_SOURCE_LANGUAGE,
      understandingLevel: body.understandingLevel,
      allowDirectAnswer: body.allowDirectAnswer
    });

    return jsonOk(tutorResponse);
  } catch (error) {
    return jsonError("Unable to generate tutor response.", 500, getErrorMessage(error));
  }
}
