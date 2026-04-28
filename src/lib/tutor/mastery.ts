import type { LearningCheckStatus } from "./types";

export type ConceptMastery = {
  id?: string;
  sessionId?: string | null;
  concept: string;
  materialId: string | null;
  attempts: number;
  correctCount: number;
  masteryScore: number;
  lastStatus: LearningCheckStatus;
  nextReviewAt: string | null;
  updatedAt: string;
};

type ConceptMasteryUpdateInput = {
  previous?: ConceptMastery | null;
  sessionId?: string | null;
  concept: string;
  materialId?: string | null;
  status: LearningCheckStatus;
  now?: Date;
};

const CHECK_REVIEW_DELAYS_MINUTES: Record<LearningCheckStatus, number> = {
  "got-it": 24 * 60,
  "needs-practice": 60,
  confused: 10
};

const STATUS_MASTERY_SCORE: Record<LearningCheckStatus, number> = {
  "got-it": 0.82,
  "needs-practice": 0.48,
  confused: 0.18
};

export function getConceptMasteryKey(concept: string, materialId?: string | null) {
  return `${materialId ?? "no-material"}::${concept.trim().toLowerCase()}`;
}

export function isScoredLearningCheckStatus(value: unknown): value is LearningCheckStatus {
  return value === "got-it" || value === "needs-practice" || value === "confused";
}

export function getLearningCheckNextReviewAt(status: LearningCheckStatus, now = new Date()) {
  return addMinutes(now, CHECK_REVIEW_DELAYS_MINUTES[status]).toISOString();
}

export function getConceptMasteryNextReviewAt(
  status: LearningCheckStatus,
  masteryScore: number,
  now = new Date()
) {
  if (status === "confused") {
    return addMinutes(now, 10).toISOString();
  }

  if (status === "needs-practice") {
    return addMinutes(now, masteryScore < 0.45 ? 30 : 2 * 60).toISOString();
  }

  if (masteryScore >= 0.9) {
    return addMinutes(now, 7 * 24 * 60).toISOString();
  }

  if (masteryScore >= 0.8) {
    return addMinutes(now, 3 * 24 * 60).toISOString();
  }

  return addMinutes(now, 24 * 60).toISOString();
}

export function updateConceptMasteryForResult(input: ConceptMasteryUpdateInput): ConceptMastery {
  const now = input.now ?? new Date();
  const previous = input.previous ?? null;
  const attempts = Math.max(0, previous?.attempts ?? 0) + 1;
  const correctCount = Math.max(0, previous?.correctCount ?? 0) + (input.status === "got-it" ? 1 : 0);
  const observedScore = STATUS_MASTERY_SCORE[input.status];
  const previousScore = Number.isFinite(previous?.masteryScore) ? previous?.masteryScore ?? 0 : 0;
  const masteryScore = previous
    ? clamp01(previousScore * 0.62 + observedScore * 0.38)
    : observedScore;

  return {
    id: previous?.id,
    sessionId: input.sessionId ?? previous?.sessionId ?? null,
    concept: normalizeConcept(input.concept),
    materialId: input.materialId ?? previous?.materialId ?? null,
    attempts,
    correctCount,
    masteryScore,
    lastStatus: input.status,
    nextReviewAt: getConceptMasteryNextReviewAt(input.status, masteryScore, now),
    updatedAt: now.toISOString()
  };
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function normalizeConcept(value: string) {
  return value.trim() || "Current concept";
}
