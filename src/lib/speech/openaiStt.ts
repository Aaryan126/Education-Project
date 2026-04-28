import OpenAI from "openai";
import { getEnv, requireOpenAIKey } from "@/lib/env";

export async function transcribeAudio(file: File, language?: string) {
  const env = getEnv();
  const client = new OpenAI({
    apiKey: requireOpenAIKey(env)
  });

  const response = await client.audio.transcriptions.create({
    file,
    model: env.OPENAI_STT_MODEL,
    language: language && language !== "auto" ? language : undefined
  });

  return {
    text: response.text,
    model: env.OPENAI_STT_MODEL
  };
}
