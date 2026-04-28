import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getTutorProvider } from "@/lib/llm";
import { classifyTutorTurn } from "@/lib/tutor/intent";
import {
  createLearnerProfile,
  normalizeLearnerProfile,
  normalizeSessionMemory,
  updateSessionMemory
} from "@/lib/tutor/memory";
import { saveStoredSessionMemory } from "@/lib/tutor/sessionMemoryStore";

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
  allowDirectAnswer: z.boolean().optional(),
  sessionId: z.string().uuid().nullable().optional(),
  materialId: z.string().uuid().nullable().optional(),
  sessionMemory: z.unknown().optional(),
  learnerProfile: z.unknown().optional(),
  activeLearningCheck: z
    .object({
      question: z.string().min(1),
      concept: z.string().min(1)
    })
    .nullable()
    .optional(),
  learningCheckEvaluation: z
    .object({
      learnerAnswer: z.string().min(1),
      status: z.enum(["got-it", "needs-practice", "confused"]),
      concept: z.string().min(1),
      feedback: z.string().default(""),
      confidence: z.coerce.number().finite().catch(0.5)
    })
    .nullable()
    .optional()
});

export async function POST(request: Request) {
  try {
    const env = getEnv();
    const body = requestSchema.parse(await request.json());
    const provider = getTutorProvider();
    const targetLanguage = body.targetLanguage || env.DEFAULT_TUTOR_LANGUAGE;
    const sourceLanguage = body.sourceLanguage || env.DEFAULT_SOURCE_LANGUAGE;
    const sessionMemory = normalizeSessionMemory(body.sessionMemory);
    const learnerProfile = normalizeLearnerProfile(
      body.learnerProfile,
      createLearnerProfile({
        targetLanguage,
        sourceLanguage,
        understandingLevel: body.understandingLevel
      })
    );
    const turnIntent = classifyTutorTurn({
      userMessage: body.userMessage,
      learningContext: body.learningContext,
      activeLearningCheck: body.activeLearningCheck ?? null
    });
    const tutorInput = {
      learningContext: body.learningContext,
      messages: body.messages,
      userMessage: body.userMessage,
      targetLanguage,
      sourceLanguage,
      understandingLevel: body.understandingLevel,
      allowDirectAnswer: body.allowDirectAnswer,
      sessionId: body.sessionId,
      materialId: body.materialId,
      sessionMemory,
      learnerProfile,
      turnIntent,
      activeLearningCheck: body.activeLearningCheck ?? null,
      learningCheckEvaluation: body.learningCheckEvaluation ?? null
    };
    const tutorResponse = await provider.generateTutorResponse(tutorInput);
    const nextSessionMemory = updateSessionMemory(tutorInput, tutorResponse);
    const responseWithMemory = {
      ...tutorResponse,
      turnIntent,
      sessionMemory: nextSessionMemory
    };

    await saveStoredSessionMemory({
      sessionId: body.sessionId,
      sessionMemory: nextSessionMemory,
      learnerProfile
    }).catch(() => undefined);

    return jsonOk(responseWithMemory);
  } catch (error) {
    return jsonError("Unable to generate tutor response.", 500, getErrorMessage(error));
  }
}
