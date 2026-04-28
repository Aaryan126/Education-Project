import type { LearnerProfile, SessionMemory, TutorRequest, TutorResponse, UnderstandingLevel } from "./types";

const MAX_LIST_ITEMS = 5;
const MAX_SUMMARY_CHARS = 900;
const MAX_ITEM_CHARS = 180;

export function createEmptySessionMemory(): SessionMemory {
  return {
    summary: "",
    currentGoal: "",
    strengths: [],
    misconceptions: [],
    openQuestions: [],
    lastEffectiveStrategy: ""
  };
}

export function createLearnerProfile({
  targetLanguage,
  sourceLanguage,
  understandingLevel
}: {
  targetLanguage: string;
  sourceLanguage: string;
  understandingLevel: UnderstandingLevel;
}): LearnerProfile {
  return {
    preferredLanguage: targetLanguage,
    sourceLanguage,
    readingLevel:
      understandingLevel === "low" ? "beginner" : understandingLevel === "high" ? "advanced" : "intermediate",
    goals: ["Understand uploaded learning materials", "Practice recall after tutor explanations"],
    explanationPreferences: ["short spoken sentences", "guided hints before final answers"],
    knownChallenges: []
  };
}

export function normalizeSessionMemory(value: unknown): SessionMemory {
  if (!value || typeof value !== "object") {
    return createEmptySessionMemory();
  }

  const raw = value as Partial<Record<keyof SessionMemory, unknown>>;

  return {
    summary: normalizeText(raw.summary),
    currentGoal: normalizeText(raw.currentGoal),
    strengths: normalizeTextList(raw.strengths),
    misconceptions: normalizeTextList(raw.misconceptions),
    openQuestions: normalizeTextList(raw.openQuestions),
    lastEffectiveStrategy: normalizeText(raw.lastEffectiveStrategy),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined
  };
}

export function normalizeLearnerProfile(value: unknown, fallback: LearnerProfile): LearnerProfile {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const raw = value as Partial<Record<keyof LearnerProfile, unknown>>;
  const readingLevel =
    raw.readingLevel === "beginner" || raw.readingLevel === "advanced" || raw.readingLevel === "intermediate"
      ? raw.readingLevel
      : fallback.readingLevel;

  return {
    preferredLanguage: normalizeText(raw.preferredLanguage) || fallback.preferredLanguage,
    sourceLanguage: normalizeText(raw.sourceLanguage) || fallback.sourceLanguage,
    readingLevel,
    goals: normalizeTextList(raw.goals, fallback.goals),
    explanationPreferences: normalizeTextList(raw.explanationPreferences, fallback.explanationPreferences),
    knownChallenges: normalizeTextList(raw.knownChallenges, fallback.knownChallenges)
  };
}

export function updateSessionMemory(input: TutorRequest, response: TutorResponse): SessionMemory {
  const previous = normalizeSessionMemory(input.sessionMemory);
  const concept = response.targetConcept || input.learningContext?.topic || "current concept";
  const latestObservation = compactText(
    [
      `Learner asked or answered: ${input.userMessage}`,
      `Tutor move: ${response.tutorMove}`,
      `Focus: ${concept}`
    ].join(" ")
  );

  const summary = mergeSummary(previous.summary, latestObservation);
  const memoryCandidates = response.memoryUpdateCandidates.map(compactText).filter(Boolean);
  const misconceptions = mergeList(
    previous.misconceptions,
    memoryCandidates
      .filter((item) => /misconception|confus|mistake|struggl/i.test(item))
      .map((item) => item.replace(/^misconception\s*:\s*/i, ""))
  );
  const strengths = mergeList(
    previous.strengths,
    response.understandingLevel === "high"
      ? [`Shows stronger understanding of ${concept}`]
      : memoryCandidates.filter((item) => /strength|got|understand|master/i.test(item))
  );
  const openQuestions = mergeList(
    response.followUpQuestion ? [response.followUpQuestion] : previous.openQuestions,
    previous.openQuestions
  );

  return {
    summary,
    currentGoal: concept,
    strengths,
    misconceptions,
    openQuestions,
    lastEffectiveStrategy: getStrategyLabel(response.tutorMove),
    updatedAt: new Date().toISOString()
  };
}

function getStrategyLabel(move: TutorResponse["tutorMove"]) {
  switch (move) {
    case "hint":
      return "Use one small hint, then ask the learner to reason.";
    case "feedback":
      return "Give corrective feedback tied to the learner's own answer.";
    case "quiz":
      return "Ask one retrieval question and wait for an answer.";
    case "summary":
      return "Summarize briefly, then check understanding.";
    case "direct_answer":
      return "Answer directly only when allowed, with brief reasoning.";
    case "clarify":
      return "Ask a clarifying question before teaching.";
    default:
      return "Explain in short spoken steps with one follow-up question.";
  }
}

function mergeSummary(previous: string, latest: string) {
  const next = [previous, latest].filter(Boolean).join(" ");
  return compactText(next).slice(-MAX_SUMMARY_CHARS).trim();
}

function mergeList(primary: string[], secondary: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const item of [...primary, ...secondary]) {
    const normalized = compactText(item).slice(0, MAX_ITEM_CHARS);
    const key = normalized.toLowerCase();

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(normalized);

    if (merged.length >= MAX_LIST_ITEMS) {
      break;
    }
  }

  return merged;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? compactText(value) : "";
}

function normalizeTextList(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) {
    return fallback.slice(0, MAX_LIST_ITEMS);
  }

  return mergeList(
    value.map((item) => String(item)),
    []
  );
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
