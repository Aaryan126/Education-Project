import type { ActiveLearningCheckContext, LearningContext, TutorTurnIntent } from "./types";

type ClassifyTutorTurnInput = {
  userMessage: string;
  learningContext?: LearningContext | null;
  activeLearningCheck?: ActiveLearningCheckContext | null;
};

export function classifyTutorTurn(input: ClassifyTutorTurnInput): TutorTurnIntent {
  const text = input.userMessage.trim().toLowerCase();

  if (input.activeLearningCheck) {
    return "answer_check";
  }

  if (!text) {
    return "ask_question";
  }

  if (/\b(final answer|just answer|give me the answer|tell me the answer|solve it|what is the answer)\b/.test(text)) {
    return "request_direct_answer";
  }

  if (/\b(quiz me|test me|practice|ask me|question me|retrieval|flashcard)\b/.test(text)) {
    return "practice_concept";
  }

  if (/\b(summarize|summarise|recap|key idea|main idea|overview)\b/.test(text)) {
    return "request_summary";
  }

  if (/\b(translate|translation|read this|read aloud|say this|pronounce|pronunciation)\b/.test(text)) {
    return "translate_or_read";
  }

  if (!input.learningContext && /^(hi|hello|hey|thanks|thank you|ok|okay)[!. ]*$/.test(text)) {
    return "off_topic";
  }

  return "ask_question";
}
