import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getSupabaseAdmin, getSupabaseOwnerKey } from "@/lib/supabase/server";
import {
  isScoredLearningCheckStatus,
  updateConceptMasteryForResult,
  type ConceptMastery
} from "@/lib/tutor/mastery";
import type { LearningCheckStatus } from "@/lib/tutor/types";

export const runtime = "nodejs";

const learningCheckStatusSchema = z.enum(["unanswered", "checking", "got-it", "needs-practice", "confused"]);

const learningCheckSchema = z.object({
  id: z.string().uuid(),
  materialId: z.string().uuid().nullable().optional(),
  materialName: z.string().min(1).default("Current material"),
  concept: z.string().min(1).default("Current concept"),
  question: z.string().min(1),
  answer: z.string().default(""),
  status: learningCheckStatusSchema,
  feedback: z.string().default(""),
  confidence: z.number().finite().nullable().optional(),
  createdAt: z.string().min(1).optional(),
  answeredAt: z.string().min(1).nullable().optional(),
  nextReviewAt: z.string().min(1).nullable().optional()
});

const upsertRequestSchema = z.object({
  sessionId: z.string().uuid().nullable().optional(),
  check: learningCheckSchema
});

const deleteRequestSchema = z.object({
  sessionId: z.string().uuid().nullable().optional(),
  checkId: z.string().uuid()
});

type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

function isMissingLearningChecksTable(error: SupabaseErrorLike | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    (message.includes("relation") && message.includes("learning_checks") && message.includes("does not exist"))
  );
}

function isMissingConceptMasteryTable(error: SupabaseErrorLike | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === "42P01" ||
    (message.includes("relation") && message.includes("concept_mastery") && message.includes("does not exist"))
  );
}

type ConceptMasteryRow = {
  id: string;
  session_id: string;
  material_id: string | null;
  concept: string;
  attempts: number;
  correct_count: number;
  mastery_score: number;
  last_status: LearningCheckStatus;
  next_review_at: string | null;
  updated_at: string;
};

type ScoredLearningCheckRow = {
  material_id: string | null;
  concept: string;
  status: LearningCheckStatus;
  created_at: string;
  answered_at: string | null;
};

function mapConceptMastery(row: ConceptMasteryRow): ConceptMastery {
  return {
    id: row.id,
    sessionId: row.session_id,
    materialId: row.material_id,
    concept: row.concept,
    attempts: row.attempts,
    correctCount: row.correct_count,
    masteryScore: row.mastery_score,
    lastStatus: row.last_status,
    nextReviewAt: row.next_review_at,
    updatedAt: row.updated_at
  };
}

async function updateConceptMastery(params: {
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>;
  ownerKey: string;
  sessionId: string;
  check: z.infer<typeof learningCheckSchema>;
}) {
  const { supabase, ownerKey, sessionId, check } = params;

  if (!isScoredLearningCheckStatus(check.status)) {
    return { persisted: false, mastery: null };
  }

  let checksQuery = supabase
    .from("learning_checks")
    .select("material_id,concept,status,created_at,answered_at")
    .eq("owner_key", ownerKey)
    .eq("session_id", sessionId)
    .ilike("concept", check.concept)
    .in("status", ["got-it", "needs-practice", "confused"])
    .order("created_at", { ascending: true });

  checksQuery = check.materialId ? checksQuery.eq("material_id", check.materialId) : checksQuery.is("material_id", null);

  const { data: scoredChecks, error: scoredChecksError } = await checksQuery;

  if (scoredChecksError) {
    throw new Error(scoredChecksError.message);
  }

  let existingQuery = supabase
    .from("concept_mastery")
    .select("id,session_id,material_id,concept,attempts,correct_count,mastery_score,last_status,next_review_at,updated_at")
    .eq("owner_key", ownerKey)
    .eq("session_id", sessionId)
    .ilike("concept", check.concept);

  existingQuery = check.materialId
    ? existingQuery.eq("material_id", check.materialId)
    : existingQuery.is("material_id", null);

  const { data: existing, error: existingError } = await existingQuery.maybeSingle();

  if (isMissingConceptMasteryTable(existingError)) {
    return { persisted: false, mastery: null };
  }

  if (existingError) {
    throw new Error(existingError.message);
  }

  const nextMastery = ((scoredChecks ?? []) as ScoredLearningCheckRow[]).reduce<ConceptMastery | null>(
    (previous, scoredCheck) => {
      const scoredAt = new Date(scoredCheck.answered_at ?? scoredCheck.created_at);

      return updateConceptMasteryForResult({
        previous,
        sessionId,
        concept: scoredCheck.concept,
        materialId: scoredCheck.material_id,
        status: scoredCheck.status,
        now: Number.isNaN(scoredAt.getTime()) ? new Date() : scoredAt
      });
    },
    null
  );

  if (!nextMastery) {
    return { persisted: false, mastery: null };
  }

  const row = {
    owner_key: ownerKey,
    session_id: sessionId,
    material_id: nextMastery.materialId,
    concept: nextMastery.concept,
    attempts: nextMastery.attempts,
    correct_count: nextMastery.correctCount,
    mastery_score: nextMastery.masteryScore,
    last_status: nextMastery.lastStatus,
    next_review_at: nextMastery.nextReviewAt,
    updated_at: nextMastery.updatedAt
  };
  const saveRequest = existing
    ? supabase
        .from("concept_mastery")
        .update(row)
        .eq("owner_key", ownerKey)
        .eq("id", (existing as ConceptMasteryRow).id)
        .select("id,session_id,material_id,concept,attempts,correct_count,mastery_score,last_status,next_review_at,updated_at")
        .single()
    : supabase
        .from("concept_mastery")
        .insert(row)
        .select("id,session_id,material_id,concept,attempts,correct_count,mastery_score,last_status,next_review_at,updated_at")
        .single();
  const { data: saved, error: saveError } = await saveRequest;

  if (isMissingConceptMasteryTable(saveError)) {
    return { persisted: false, mastery: null };
  }

  if (saveError || !saved) {
    throw new Error(saveError?.message || "Unable to update concept mastery.");
  }

  return { persisted: true, mastery: mapConceptMastery(saved as ConceptMasteryRow) };
}

export async function POST(request: Request) {
  try {
    const body = upsertRequestSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    if (!supabase || !body.sessionId) {
      return jsonOk({ persisted: false });
    }

    const ownerKey = getSupabaseOwnerKey();
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id")
      .eq("owner_key", ownerKey)
      .eq("id", body.sessionId)
      .maybeSingle();

    if (sessionError) {
      throw new Error(sessionError.message);
    }

    if (!session) {
      return jsonError("Session not found.", 404);
    }

    const check = body.check;
    const now = new Date().toISOString();
    const { error } = await supabase.from("learning_checks").upsert(
      {
        id: check.id,
        session_id: body.sessionId,
        owner_key: ownerKey,
        material_id: check.materialId ?? null,
        material_name: check.materialName,
        concept: check.concept,
        question: check.question,
        answer: check.answer,
        status: check.status,
        feedback: check.feedback,
        confidence: check.confidence ?? null,
        created_at: check.createdAt ?? now,
        answered_at: check.answeredAt ?? null,
        next_review_at: check.nextReviewAt ?? null,
        updated_at: now
      },
      { onConflict: "id" }
    );

    if (isMissingLearningChecksTable(error)) {
      return jsonOk({ persisted: false, reason: "The learning_checks table has not been migrated yet." });
    }

    if (error) {
      throw new Error(error.message);
    }

    const masteryResult = await updateConceptMastery({
      supabase,
      ownerKey,
      sessionId: body.sessionId,
      check
    });

    await supabase
      .from("sessions")
      .update({ updated_at: now })
      .eq("id", body.sessionId)
      .eq("owner_key", ownerKey);

    return jsonOk({
      persisted: true,
      checkId: check.id,
      mastery: masteryResult.mastery,
      masteryPersisted: masteryResult.persisted
    });
  } catch (error) {
    return jsonError("Unable to save progress check.", 500, getErrorMessage(error));
  }
}

export async function DELETE(request: Request) {
  try {
    const body = deleteRequestSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    if (!supabase || !body.sessionId) {
      return jsonOk({ persisted: false, deleted: false });
    }

    const ownerKey = getSupabaseOwnerKey();
    const { error } = await supabase
      .from("learning_checks")
      .delete()
      .eq("owner_key", ownerKey)
      .eq("session_id", body.sessionId)
      .eq("id", body.checkId);

    if (isMissingLearningChecksTable(error)) {
      return jsonOk({ persisted: false, deleted: false, reason: "The learning_checks table has not been migrated yet." });
    }

    if (error) {
      throw new Error(error.message);
    }

    await supabase
      .from("sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", body.sessionId)
      .eq("owner_key", ownerKey);

    return jsonOk({ persisted: true, deleted: true, checkId: body.checkId });
  } catch (error) {
    return jsonError("Unable to delete progress check.", 500, getErrorMessage(error));
  }
}
