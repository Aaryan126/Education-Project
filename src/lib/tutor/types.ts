export type UnderstandingLevel = "low" | "medium" | "high";

export type TutorTurnIntent =
  | "ask_question"
  | "answer_check"
  | "request_summary"
  | "request_direct_answer"
  | "practice_concept"
  | "translate_or_read"
  | "off_topic";

export type TutorMove = "hint" | "explain" | "feedback" | "quiz" | "summary" | "direct_answer" | "clarify";

export type ConversationMessage = {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
};

export type LearningContext = {
  detectedLanguage: string;
  extractedText: string;
  topic: string;
  summary: string;
  diagramNotes: string;
  suggestedQuestion: string;
  confidence: number;
};

export type SessionMemory = {
  summary: string;
  currentGoal: string;
  strengths: string[];
  misconceptions: string[];
  openQuestions: string[];
  lastEffectiveStrategy: string;
  updatedAt?: string;
};

export type LearnerProfile = {
  preferredLanguage: string;
  sourceLanguage: string;
  readingLevel: "beginner" | "intermediate" | "advanced";
  goals: string[];
  explanationPreferences: string[];
  knownChallenges: string[];
};

export type ActiveLearningCheckContext = {
  question: string;
  concept: string;
};

export type TutorRequest = {
  learningContext?: LearningContext | null;
  messages: ConversationMessage[];
  userMessage: string;
  targetLanguage: string;
  sourceLanguage: string;
  understandingLevel: UnderstandingLevel;
  allowDirectAnswer?: boolean;
  sessionId?: string | null;
  materialId?: string | null;
  sessionMemory?: SessionMemory | null;
  learnerProfile?: LearnerProfile | null;
  turnIntent?: TutorTurnIntent;
  activeLearningCheck?: ActiveLearningCheckContext | null;
};

export type TutorResponse = {
  response: string;
  followUpQuestion: string;
  targetConcept: string;
  tutorMove: TutorMove;
  understandingLevel: UnderstandingLevel;
  directAnswerGiven: boolean;
  confidence: number;
  usedSourceChunkIds: string[];
  memoryUpdateCandidates: string[];
  turnIntent: TutorTurnIntent;
  sessionMemory?: SessionMemory;
  provider: string;
};

export type LearningCheckStatus = "got-it" | "needs-practice" | "confused";

export type LearningCheckEvaluation = {
  status: LearningCheckStatus;
  concept: string;
  feedback: string;
  confidence: number;
  provider: string;
};
