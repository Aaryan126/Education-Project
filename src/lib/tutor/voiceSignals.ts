import { z } from "zod";
import type { VoiceInteractionSignals } from "./types";

export const voiceInteractionSignalsSchema = z
  .object({
    inputMode: z.literal("voice"),
    smartTurnProbability: z.number().min(0).max(1).nullable().default(null),
    smartTurnSource: z
      .enum(["smart-turn-endpoint", "smart-turn-python", "vad-fallback", "disabled"])
      .nullable()
      .default(null),
    incompleteTurnCount: z.number().int().nonnegative().default(0),
    forcedAfterLongSilence: z.boolean().default(false),
    speechSegmentCount: z.number().int().nonnegative().default(0),
    answerAudioDurationMs: z.number().nonnegative().default(0),
    transcriptWordCount: z.number().int().nonnegative().default(0),
    transcriptCharacterCount: z.number().int().nonnegative().default(0),
    transcriptHasUncertaintyMarkers: z.boolean().default(false),
    uncertaintyMarkers: z.array(z.string()).default([]),
    isShortAnswer: z.boolean().default(false),
    isNumericAnswer: z.boolean().default(false)
  })
  .nullable()
  .optional();

export function formatVoiceInteractionSignals(signals?: VoiceInteractionSignals | null) {
  if (!signals) {
    return "None, or this was text input.";
  }

  const smartTurnProbability =
    typeof signals.smartTurnProbability === "number" ? signals.smartTurnProbability.toFixed(2) : "unknown";
  const uncertaintyMarkers = signals.uncertaintyMarkers.length > 0 ? signals.uncertaintyMarkers.join("; ") : "None";
  const shortAnswerNote =
    signals.isShortAnswer || signals.isNumericAnswer
      ? "This answer is short or numeric. Treat that as normal for factual or numeric questions, not as hesitation by itself."
      : "This answer is not especially short.";

  return [
    "Input mode: voice",
    `Smart Turn probability of completion: ${smartTurnProbability}`,
    `Smart Turn source: ${signals.smartTurnSource ?? "unknown"}`,
    `Incomplete pause count before submission: ${signals.incompleteTurnCount}`,
    `Forced after long silence: ${signals.forcedAfterLongSilence ? "yes" : "no"}`,
    `Speech segments in final answer: ${signals.speechSegmentCount}`,
    `Answer audio duration: ${Math.round(signals.answerAudioDurationMs)}ms`,
    `Transcript length: ${signals.transcriptWordCount} word/token(s), ${signals.transcriptCharacterCount} character(s)`,
    `Uncertainty markers: ${uncertaintyMarkers}`,
    shortAnswerNote
  ].join("\n");
}
