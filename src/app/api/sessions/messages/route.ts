import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getSupabaseAdmin, getSupabaseOwnerKey } from "@/lib/supabase/server";

export const runtime = "nodejs";

const messageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1)
});

const requestSchema = z.object({
  sessionId: z.string().uuid().nullable().optional(),
  messages: z.array(messageSchema).min(1)
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    if (!supabase || !body.sessionId) {
      return jsonOk({ persisted: false });
    }

    const ownerKey = getSupabaseOwnerKey();
    const rows = body.messages.map((message) => ({
      session_id: body.sessionId,
      owner_key: ownerKey,
      client_id: message.id || null,
      role: message.role,
      content: message.content
    }));

    const { error } = await supabase.from("messages").insert(rows);

    if (error) {
      throw new Error(error.message);
    }

    await supabase
      .from("sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", body.sessionId)
      .eq("owner_key", ownerKey);

    return jsonOk({ persisted: true });
  } catch (error) {
    return jsonError("Unable to save messages.", 500, getErrorMessage(error));
  }
}
