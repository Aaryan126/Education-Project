export type UnderstandingLevel = "low" | "medium" | "high";

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

export type TutorRequest = {
  learningContext?: LearningContext | null;
  messages: ConversationMessage[];
  userMessage: string;
  targetLanguage: string;
  sourceLanguage: string;
  understandingLevel: UnderstandingLevel;
  allowDirectAnswer?: boolean;
};

export type TutorResponse = {
  response: string;
  followUpQuestion: string;
  understandingLevel: UnderstandingLevel;
  directAnswerGiven: boolean;
  confidence: number;
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
