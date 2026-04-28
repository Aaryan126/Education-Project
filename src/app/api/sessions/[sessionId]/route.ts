import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getSupabaseAdmin, getSupabaseOwnerKey } from "@/lib/supabase/server";

export const runtime = "nodejs";

const paramsSchema = z.object({
  sessionId: z.string().uuid()
});

const learningContextSchema = z.object({
  detectedLanguage: z.string().default("Unknown"),
  extractedText: z.string().default(""),
  topic: z.string().default("Learning material"),
  summary: z.string().default(""),
  diagramNotes: z.string().default(""),
  suggestedQuestion: z.string().default(""),
  confidence: z.coerce.number().finite().catch(0)
});

type StoredMaterialRef = {
  storage_bucket: string | null;
  storage_path: string | null;
};

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

async function removeStoredMaterials(materials: StoredMaterialRef[]) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return;
  }

  const pathsByBucket = new Map<string, string[]>();

  for (const material of materials) {
    if (!material.storage_bucket || !material.storage_path) {
      continue;
    }

    pathsByBucket.set(material.storage_bucket, [
      ...(pathsByBucket.get(material.storage_bucket) ?? []),
      material.storage_path
    ]);
  }

  for (const [bucket, paths] of pathsByBucket) {
    const { error } = await supabase.storage.from(bucket).remove(paths);

    if (error) {
      throw new Error(error.message);
    }
  }
}

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = paramsSchema.parse(await context.params);
    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return jsonError("Supabase is not configured.", 400);
    }

    const ownerKey = getSupabaseOwnerKey();
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id,title,target_language,source_language,status,created_at,updated_at")
      .eq("owner_key", ownerKey)
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return jsonError("Session not found.", 404, sessionError?.message);
    }

    const [
      { data: materialRows, error: materialsError },
      { data: messageRows, error: messagesError },
      { data: learningCheckRows, error: learningChecksError }
    ] = await Promise.all([
      supabase
        .from("materials")
        .select("id,name,mime_type,storage_bucket,storage_path,learning_context,created_at")
        .eq("owner_key", ownerKey)
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true }),
      supabase
        .from("messages")
        .select("id,client_id,role,content,created_at")
        .eq("owner_key", ownerKey)
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true }),
      supabase
        .from("learning_checks")
        .select(
          "id,material_id,material_name,concept,question,answer,status,feedback,confidence,created_at,answered_at,next_review_at"
        )
        .eq("owner_key", ownerKey)
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
    ]);

    if (materialsError) {
      throw new Error(materialsError.message);
    }

    if (messagesError) {
      throw new Error(messagesError.message);
    }

    if (learningChecksError && !isMissingLearningChecksTable(learningChecksError)) {
      throw new Error(learningChecksError.message);
    }

    const materials = await Promise.all(
      (materialRows ?? []).map(async (material) => {
        let imageDataUrl: string | null = null;

        if (material.mime_type.startsWith("image/") && material.storage_bucket && material.storage_path) {
          const { data } = await supabase.storage
            .from(material.storage_bucket)
            .createSignedUrl(material.storage_path, 60 * 60);

          imageDataUrl = data?.signedUrl ?? null;
        }

        return {
          id: material.id,
          name: material.name,
          mimeType: material.mime_type,
          imageDataUrl,
          learningContext: learningContextSchema.parse(material.learning_context),
          createdAt: material.created_at
        };
      })
    );

    return jsonOk({
      session: {
        id: session.id,
        title: session.title,
        targetLanguage: session.target_language,
        sourceLanguage: session.source_language,
        status: session.status,
        createdAt: session.created_at,
        updatedAt: session.updated_at
      },
      materials,
      messages: (messageRows ?? []).map((message) => ({
        id: message.client_id || message.id,
        role: message.role,
        content: message.content,
        createdAt: message.created_at
      })),
      learningChecks: learningChecksError
        ? []
        : (learningCheckRows ?? []).map((check) => ({
            id: check.id,
            materialId: check.material_id,
            materialName: check.material_name,
            concept: check.concept,
            question: check.question,
            answer: check.answer,
            status: check.status,
            feedback: check.feedback,
            confidence: check.confidence,
            createdAt: check.created_at,
            answeredAt: check.answered_at,
            nextReviewAt: check.next_review_at
          }))
    });
  } catch (error) {
    return jsonError("Unable to load session.", 500, getErrorMessage(error));
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = paramsSchema.parse(await context.params);
    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return jsonError("Supabase is not configured.", 400);
    }

    const ownerKey = getSupabaseOwnerKey();
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id")
      .eq("owner_key", ownerKey)
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return jsonError("Session not found.", 404, sessionError?.message);
    }

    const { data: materialRows, error: materialsError } = await supabase
      .from("materials")
      .select("storage_bucket,storage_path")
      .eq("owner_key", ownerKey)
      .eq("session_id", sessionId);

    if (materialsError) {
      throw new Error(materialsError.message);
    }

    await removeStoredMaterials((materialRows ?? []) as StoredMaterialRef[]);

    const { error: deleteError } = await supabase
      .from("sessions")
      .delete()
      .eq("owner_key", ownerKey)
      .eq("id", sessionId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    return jsonOk({ deleted: true, sessionId });
  } catch (error) {
    return jsonError("Unable to delete session.", 500, getErrorMessage(error));
  }
}
