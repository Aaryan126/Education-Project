import { getEnv } from "@/lib/env";
import { getSupabaseAdmin, getSupabaseOwnerKey } from "@/lib/supabase/server";

export type TtsUsageProvider = "browser" | "google" | "openai";

export type TtsUsageSnapshot = {
  provider: TtsUsageProvider;
  month: string;
  characters: number;
  requests: number;
  freeTierCharacters: number;
  remainingFreeTierCharacters: number;
  usagePercent: number;
  persisted: boolean;
  updatedAt: string | null;
  error?: string;
};

type TtsUsageRow = {
  usage_month?: unknown;
  provider?: unknown;
  character_count?: unknown;
  request_count?: unknown;
  updated_at?: unknown;
};

export function clampTtsInput(text: string) {
  return Array.from(text).slice(0, 4096).join("");
}

export function countTtsCharacters(text: string) {
  return Array.from(clampTtsInput(text)).length;
}

export function getCurrentUsageMonth(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}

export function getTtsFreeTierCharacters(provider: TtsUsageProvider) {
  if (provider !== "google") {
    return 0;
  }

  return Math.max(0, Math.floor(getEnv().GOOGLE_TTS_MONTHLY_FREE_CHARACTERS));
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toStringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function getUsageErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return fallback;
}

function makeTtsUsageSnapshot({
  provider,
  month,
  characters = 0,
  requests = 0,
  persisted,
  updatedAt = null,
  error
}: {
  provider: TtsUsageProvider;
  month: string;
  characters?: number;
  requests?: number;
  persisted: boolean;
  updatedAt?: string | null;
  error?: string;
}): TtsUsageSnapshot {
  const freeTierCharacters = getTtsFreeTierCharacters(provider);
  const remainingFreeTierCharacters =
    freeTierCharacters > 0 ? Math.max(0, freeTierCharacters - characters) : 0;
  const usagePercent = freeTierCharacters > 0 ? Math.min(100, (characters / freeTierCharacters) * 100) : 0;

  return {
    provider,
    month,
    characters,
    requests,
    freeTierCharacters,
    remainingFreeTierCharacters,
    usagePercent,
    persisted,
    updatedAt,
    ...(error ? { error } : {})
  };
}

function rowToSnapshot(row: TtsUsageRow | null, provider: TtsUsageProvider, month: string, persisted: boolean) {
  if (!row) {
    return makeTtsUsageSnapshot({ provider, month, persisted });
  }

  return makeTtsUsageSnapshot({
    provider,
    month: toStringOrNull(row.usage_month) ?? month,
    characters: toNumber(row.character_count),
    requests: toNumber(row.request_count),
    persisted,
    updatedAt: toStringOrNull(row.updated_at)
  });
}

function normalizeRpcRow(data: unknown): TtsUsageRow | null {
  if (Array.isArray(data)) {
    return (data[0] as TtsUsageRow | undefined) ?? null;
  }

  if (data && typeof data === "object") {
    return data as TtsUsageRow;
  }

  return null;
}

export async function getCurrentTtsUsage(provider: TtsUsageProvider = getEnv().TTS_PROVIDER) {
  const month = getCurrentUsageMonth();
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return makeTtsUsageSnapshot({
      provider,
      month,
      persisted: false,
      error: "Supabase is not configured, so usage tracking is not persisted."
    });
  }

  try {
    const { data, error } = await supabase
      .from("tts_usage_months")
      .select("usage_month, provider, character_count, request_count, updated_at")
      .eq("owner_key", getSupabaseOwnerKey())
      .eq("usage_month", month)
      .eq("provider", provider)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return rowToSnapshot(data as TtsUsageRow | null, provider, month, true);
  } catch (error) {
    return makeTtsUsageSnapshot({
      provider,
      month,
      persisted: false,
      error: getUsageErrorMessage(error, "Unable to load TTS usage.")
    });
  }
}

export async function recordTtsUsage(provider: Exclude<TtsUsageProvider, "browser">, characters: number) {
  const month = getCurrentUsageMonth();
  const normalizedCharacters = Math.max(0, Math.floor(characters));
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return makeTtsUsageSnapshot({
      provider,
      month,
      characters: normalizedCharacters,
      requests: normalizedCharacters > 0 ? 1 : 0,
      persisted: false,
      error: "Supabase is not configured, so usage tracking is not persisted."
    });
  }

  try {
    const { data, error } = await supabase.rpc("increment_tts_usage_month", {
      p_owner_key: getSupabaseOwnerKey(),
      p_usage_month: month,
      p_provider: provider,
      p_character_count: normalizedCharacters
    });

    if (error) {
      throw error;
    }

    return rowToSnapshot(normalizeRpcRow(data), provider, month, true);
  } catch (error) {
    return makeTtsUsageSnapshot({
      provider,
      month,
      characters: normalizedCharacters,
      requests: normalizedCharacters > 0 ? 1 : 0,
      persisted: false,
      error: getUsageErrorMessage(error, "Unable to record TTS usage.")
    });
  }
}
