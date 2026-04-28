import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { evaluateLearningCheck } from "@/lib/tutor/evaluate";
import { voiceInteractionSignalsSchema } from "@/lib/tutor/voiceSignals";

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

const requestSchema = z.object({
  learningContext: learningContextSchema,
  retrievalQuestion: z.string().min(1),
  learnerAnswer: z.string().min(1),
  targetLanguage: z.string().default("en"),
  voiceInteractionSignals: voiceInteractionSignalsSchema
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const evaluation = await evaluateLearningCheck({
      learningContext: body.learningContext,
      retrievalQuestion: body.retrievalQuestion,
      learnerAnswer: body.learnerAnswer,
      targetLanguage: body.targetLanguage,
      voiceInteractionSignals: body.voiceInteractionSignals ?? null
    });

    return jsonOk(evaluation);
  } catch (error) {
    return jsonError("Unable to evaluate learning check.", 500, getErrorMessage(error));
  }
}
