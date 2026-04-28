import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { parseDataUrl } from "@/lib/documents/extractText";
import {
  getSupabaseAdmin,
  getSupabaseOwnerKey,
  getSupabaseStorageBucket
} from "@/lib/supabase/server";

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

const materialSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  dataUrl: z.string().optional(),
  learningContext: learningContextSchema
});

const requestSchema = z.object({
  title: z.string().min(1).default("Learning session"),
  targetLanguage: z.string().default("en"),
  sourceLanguage: z.string().default("auto"),
  materials: z.array(materialSchema).min(1)
});

type CountableRow = {
  session_id: string;
};

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+/, "") || "material";
}

function countBySession(rows: CountableRow[] | null) {
  const counts = new Map<string, number>();

  for (const row of rows ?? []) {
    counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1);
  }

  return counts;
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return jsonOk({ sessions: [], persisted: false });
    }

    const ownerKey = getSupabaseOwnerKey();
    const { data: sessions, error: sessionsError } = await supabase
      .from("sessions")
      .select("id,title,target_language,source_language,status,created_at,updated_at")
      .eq("owner_key", ownerKey)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (sessionsError) {
      throw new Error(sessionsError.message);
    }

    const sessionIds = (sessions ?? []).map((session) => session.id);

    if (sessionIds.length === 0) {
      return jsonOk({ sessions: [], persisted: true });
    }

    const [{ data: materialRows, error: materialsError }, { data: messageRows, error: messagesError }] =
      await Promise.all([
        supabase.from("materials").select("session_id").eq("owner_key", ownerKey).in("session_id", sessionIds),
        supabase.from("messages").select("session_id").eq("owner_key", ownerKey).in("session_id", sessionIds)
      ]);

    if (materialsError) {
      throw new Error(materialsError.message);
    }

    if (messagesError) {
      throw new Error(messagesError.message);
    }

    const materialCounts = countBySession(materialRows);
    const messageCounts = countBySession(messageRows);

    return jsonOk({
      persisted: true,
      sessions: (sessions ?? []).map((session) => ({
        id: session.id,
        title: session.title,
        targetLanguage: session.target_language,
        sourceLanguage: session.source_language,
        status: session.status,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        materialCount: materialCounts.get(session.id) ?? 0,
        messageCount: messageCounts.get(session.id) ?? 0
      }))
    });
  } catch (error) {
    return jsonError("Unable to load sessions.", 500, getErrorMessage(error));
  }
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return jsonOk({ persisted: false, sessionId: null, reason: "Supabase is not configured." });
    }

    const ownerKey = getSupabaseOwnerKey();
    const storageBucket = getSupabaseStorageBucket();

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        owner_key: ownerKey,
        title: body.title,
        target_language: body.targetLanguage,
        source_language: body.sourceLanguage,
        status: "active"
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      throw new Error(sessionError?.message || "Unable to create Supabase session row.");
    }

    const materialRows = [];

    for (const material of body.materials) {
      let storagePath: string | null = null;
      let uploadedMimeType = material.mimeType;

      if (material.dataUrl) {
        const parsed = parseDataUrl(material.dataUrl);
        uploadedMimeType = material.mimeType || parsed.mimeType;
        storagePath = `${ownerKey}/${session.id}/${material.id}/${sanitizeFileName(material.name)}`;

        const { error: uploadError } = await supabase.storage.from(storageBucket).upload(storagePath, parsed.buffer, {
          contentType: uploadedMimeType,
          upsert: true
        });

        if (uploadError) {
          throw new Error(uploadError.message);
        }
      }

      materialRows.push({
        id: material.id,
        session_id: session.id,
        owner_key: ownerKey,
        name: material.name,
        mime_type: uploadedMimeType,
        storage_bucket: storagePath ? storageBucket : null,
        storage_path: storagePath,
        learning_context: material.learningContext
      });
    }

    const { error: materialsError } = await supabase.from("materials").insert(materialRows);

    if (materialsError) {
      throw new Error(materialsError.message);
    }

    return jsonOk({ persisted: true, sessionId: session.id });
  } catch (error) {
    return jsonError("Unable to save session.", 500, getErrorMessage(error));
  }
}
