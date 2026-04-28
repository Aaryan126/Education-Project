import { getSupabaseAdmin, getSupabaseOwnerKey } from "@/lib/supabase/server";
import {
  createLearnerProfile,
  normalizeLearnerProfile,
  normalizeSessionMemory
} from "@/lib/tutor/memory";
import type { LearnerProfile, SessionMemory, UnderstandingLevel } from "@/lib/tutor/types";

type StoredSessionMemoryRow = {
  learning_memory: unknown;
  learner_profile: unknown;
};

export async function loadStoredSessionMemory({
  sessionId,
  targetLanguage,
  sourceLanguage,
  understandingLevel = "medium"
}: {
  sessionId: string;
  targetLanguage: string;
  sourceLanguage: string;
  understandingLevel?: UnderstandingLevel;
}) {
  const fallbackProfile = createLearnerProfile({ targetLanguage, sourceLanguage, understandingLevel });
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return {
      sessionMemory: normalizeSessionMemory(null),
      learnerProfile: fallbackProfile,
      persisted: false
    };
  }

  const ownerKey = getSupabaseOwnerKey();
  const { data, error } = await supabase
    .from("session_memories")
    .select("learning_memory,learner_profile")
    .eq("owner_key", ownerKey)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    if (isMissingSessionMemoriesTable(error)) {
      return {
        sessionMemory: normalizeSessionMemory(null),
        learnerProfile: fallbackProfile,
        persisted: false
      };
    }

    throw new Error(error.message);
  }

  const row = data as StoredSessionMemoryRow | null;

  return {
    sessionMemory: normalizeSessionMemory(row?.learning_memory),
    learnerProfile: normalizeLearnerProfile(row?.learner_profile, fallbackProfile),
    persisted: Boolean(row)
  };
}

export async function saveStoredSessionMemory({
  sessionId,
  sessionMemory,
  learnerProfile
}: {
  sessionId?: string | null;
  sessionMemory: SessionMemory;
  learnerProfile: LearnerProfile;
}) {
  const supabase = getSupabaseAdmin();

  if (!supabase || !sessionId) {
    return { persisted: false };
  }

  const ownerKey = getSupabaseOwnerKey();
  const now = new Date().toISOString();
  const { error } = await supabase.from("session_memories").upsert(
    {
      session_id: sessionId,
      owner_key: ownerKey,
      learning_memory: sessionMemory,
      learner_profile: learnerProfile,
      updated_at: now
    },
    { onConflict: "session_id" }
  );

  if (error) {
    if (isMissingSessionMemoriesTable(error)) {
      return { persisted: false };
    }

    throw new Error(error.message);
  }

  await supabase
    .from("sessions")
    .update({ updated_at: now })
    .eq("id", sessionId)
    .eq("owner_key", ownerKey);

  return { persisted: true };
}

function isMissingSessionMemoriesTable(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";

  return (
    error.code === "42P01" ||
    (message.includes("relation") && message.includes("session_memories") && message.includes("does not exist")) ||
    message.includes("session_memories")
  );
}
