import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getSupabaseAdmin, getSupabaseOwnerKey } from "@/lib/supabase/server";

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

    await supabase
      .from("sessions")
      .update({ updated_at: now })
      .eq("id", body.sessionId)
      .eq("owner_key", ownerKey);

    return jsonOk({ persisted: true, checkId: check.id });
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
