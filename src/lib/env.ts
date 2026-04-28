import { z } from "zod";

const optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());
const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());

const envSchema = z.object({
  ANTHROPIC_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  ZAI_API_KEY: optionalString,
  ZAI_BASE_URL: optionalUrl,
  LLM_PROVIDER: z.enum(["anthropic", "zai"]).default("anthropic"),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),
  ZAI_MODEL: z.string().default("glm-4.6"),
  OPENAI_VISION_MODEL: z.string().default("gpt-4o"),
  OPENAI_STT_MODEL: z.string().default("gpt-4o-transcribe"),
  TTS_PROVIDER: z.enum(["browser", "openai", "google"]).default("browser"),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  OPENAI_TTS_VOICE: z.string().default("onyx"),
  GOOGLE_TTS_CREDENTIALS_JSON: optionalString,
  GOOGLE_TTS_PROJECT_ID: optionalString,
  GOOGLE_TTS_LANGUAGE_CODE: z.string().default("en-US"),
  GOOGLE_TTS_VOICE: z.string().default("en-US-Chirp3-HD-Orus"),
  GOOGLE_TTS_API_ENDPOINT: optionalString,
  GOOGLE_TTS_MONTHLY_FREE_CHARACTERS: z.coerce.number().default(1_000_000),
  SUPABASE_URL: optionalUrl,
  SUPABASE_SECRET_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_STORAGE_BUCKET: z.string().default("materials"),
  SUPABASE_OWNER_KEY: z.string().default("main"),
  DEFAULT_TUTOR_LANGUAGE: z.string().default("zh-CN"),
  DEFAULT_SOURCE_LANGUAGE: z.string().default("auto"),
  DEFAULT_TTS_VOICE: z.string().default("en-US-GuyNeural"),
  SMART_TURN_MODE: z.enum(["auto", "off"]).default("auto"),
  SMART_TURN_ENDPOINT: optionalUrl,
  SMART_TURN_PYTHON: z.string().default("python3"),
  SMART_TURN_MODEL_PATH: optionalString,
  SMART_TURN_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  SMART_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  APP_ENV: z.string().default("development"),
  APP_PORT: z.coerce.number().default(3000)
});

export type RuntimeEnv = z.infer<typeof envSchema>;

export function getEnv(): RuntimeEnv {
  return envSchema.parse(process.env);
}

export function getMissingRuntimeKeys(env = getEnv()) {
  const missing: string[] = [];

  if (!env.OPENAI_API_KEY) {
    missing.push("OPENAI_API_KEY");
  }

  if (env.LLM_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
    missing.push("ANTHROPIC_API_KEY");
  }

  if (env.LLM_PROVIDER === "zai" && !env.ZAI_API_KEY) {
    missing.push("ZAI_API_KEY");
  }

  if (env.LLM_PROVIDER === "zai" && !env.ZAI_BASE_URL) {
    missing.push("ZAI_BASE_URL");
  }

  return missing;
}

export function requireOpenAIKey(env = getEnv()) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for vision and speech-to-text.");
  }

  return env.OPENAI_API_KEY;
}

export function requireTutorProviderKeys(env = getEnv()) {
  if (env.LLM_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic.");
  }

  if (env.LLM_PROVIDER === "zai") {
    if (!env.ZAI_API_KEY) {
      throw new Error("ZAI_API_KEY is required when LLM_PROVIDER=zai.");
    }

    if (!env.ZAI_BASE_URL) {
      throw new Error("ZAI_BASE_URL is required when LLM_PROVIDER=zai.");
    }
  }
}
