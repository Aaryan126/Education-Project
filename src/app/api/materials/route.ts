import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getSupabaseAdmin, getSupabaseOwnerKey } from "@/lib/supabase/server";

export const runtime = "nodejs";

const learningContextSchema = z.object({
  detectedLanguage: z.string().default("Unknown"),
  extractedText: z.string().default(""),
  topic: z.string().default("Learning material"),
  summary: z.string().default(""),
  diagramNotes: z.string().default(""),
  suggestedQuestion: z.string().default(""),
  confidence: z.coerce.number().finite().catch(0)
});

type MaterialRow = {
  id: string;
  session_id: string;
  name: string;
  mime_type: string;
  storage_bucket: string | null;
  storage_path: string | null;
  learning_context: unknown;
  created_at: string;
};

type SessionRow = {
  id: string;
  title: string;
  target_language: string;
  source_language: string;
  updated_at: string;
};

async function createSignedMaterialUrls(row: MaterialRow) {
  const supabase = getSupabaseAdmin();

  if (!supabase || !row.storage_bucket || !row.storage_path) {
    return {
      viewUrl: null,
      downloadUrl: null
    };
  }

  const storage = supabase.storage.from(row.storage_bucket);
  const [{ data: viewData, error: viewError }, { data: downloadData, error: downloadError }] = await Promise.all([
    storage.createSignedUrl(row.storage_path, 60 * 60),
    storage.createSignedUrl(row.storage_path, 60 * 60, { download: row.name })
  ]);

  if (viewError) {
    throw new Error(viewError.message);
  }

  if (downloadError) {
    throw new Error(downloadError.message);
  }

  return {
    viewUrl: viewData?.signedUrl ?? null,
    downloadUrl: downloadData?.signedUrl ?? null
  };
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return jsonOk({ materials: [], persisted: false });
    }

    const ownerKey = getSupabaseOwnerKey();
    const { data: materialRows, error: materialsError } = await supabase
      .from("materials")
      .select("id,session_id,name,mime_type,storage_bucket,storage_path,learning_context,created_at")
      .eq("owner_key", ownerKey)
      .order("created_at", { ascending: false })
      .limit(100);

    if (materialsError) {
      throw new Error(materialsError.message);
    }

    const sessionIds = Array.from(new Set((materialRows ?? []).map((material) => material.session_id)));
    const sessionById = new Map<string, SessionRow>();

    if (sessionIds.length > 0) {
      const { data: sessionRows, error: sessionsError } = await supabase
        .from("sessions")
        .select("id,title,target_language,source_language,updated_at")
        .eq("owner_key", ownerKey)
        .in("id", sessionIds);

      if (sessionsError) {
        throw new Error(sessionsError.message);
      }

      for (const session of (sessionRows ?? []) as SessionRow[]) {
        sessionById.set(session.id, session);
      }
    }

    const materials = await Promise.all(
      ((materialRows ?? []) as MaterialRow[]).map(async (material) => {
        const session = sessionById.get(material.session_id);
        const { viewUrl, downloadUrl } = await createSignedMaterialUrls(material);

        return {
          id: material.id,
          sessionId: material.session_id,
          name: material.name,
          mimeType: material.mime_type,
          viewUrl,
          downloadUrl,
          createdAt: material.created_at,
          learningContext: learningContextSchema.parse(material.learning_context),
          session: session
            ? {
                id: session.id,
                title: session.title,
                targetLanguage: session.target_language,
                sourceLanguage: session.source_language,
                updatedAt: session.updated_at
              }
            : null
        };
      })
    );

    return jsonOk({ persisted: true, materials });
  } catch (error) {
    return jsonError("Unable to load materials.", 500, getErrorMessage(error));
  }
}
