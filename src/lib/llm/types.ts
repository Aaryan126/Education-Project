import type { TutorRequest, TutorResponse } from "@/lib/tutor/types";

export type LLMProviderName = "anthropic" | "zai";

export type LLMProvider = {
  readonly name: LLMProviderName;
  generateTutorResponse(input: TutorRequest): Promise<TutorResponse>;
};
