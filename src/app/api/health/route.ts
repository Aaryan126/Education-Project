import { getEnv, getMissingRuntimeKeys } from "@/lib/env";
import { jsonError, jsonOk } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const env = getEnv();
    const missingKeys = getMissingRuntimeKeys(env);

    return jsonOk({
      ok: missingKeys.length === 0,
      appEnv: env.APP_ENV,
      llmProvider: env.LLM_PROVIDER,
      ttsProvider: env.TTS_PROVIDER,
      supabaseConfigured: isSupabaseConfigured(),
      models: {
        anthropic: env.ANTHROPIC_MODEL,
        zai: env.ZAI_MODEL,
        vision: env.OPENAI_VISION_MODEL,
        stt: env.OPENAI_STT_MODEL,
        tts: env.TTS_PROVIDER === "google" ? env.GOOGLE_TTS_VOICE : env.OPENAI_TTS_MODEL
      },
      defaults: {
        tutorLanguage: env.DEFAULT_TUTOR_LANGUAGE,
        sourceLanguage: env.DEFAULT_SOURCE_LANGUAGE,
        ttsVoice: env.DEFAULT_TTS_VOICE
      },
      missingKeys
    });
  } catch (error) {
    return jsonError("Invalid environment configuration.", 500, error instanceof Error ? error.message : error);
  }
}
