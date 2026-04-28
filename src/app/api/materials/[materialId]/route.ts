import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { getSupabaseAdmin, getSupabaseOwnerKey } from "@/lib/supabase/server";

export const runtime = "nodejs";

const paramsSchema = z.object({
  materialId: z.string().uuid()
});

export async function DELETE(_request: Request, context: { params: Promise<{ materialId: string }> }) {
  try {
    const { materialId } = paramsSchema.parse(await context.params);
    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return jsonError("Supabase is not configured.", 400);
    }

    const ownerKey = getSupabaseOwnerKey();
    const { data: material, error: materialError } = await supabase
      .from("materials")
      .select("id,session_id,storage_bucket,storage_path")
      .eq("owner_key", ownerKey)
      .eq("id", materialId)
      .single();

    if (materialError || !material) {
      return jsonError("Material not found.", 404, materialError?.message);
    }

    if (material.storage_bucket && material.storage_path) {
      const { error: storageError } = await supabase.storage
        .from(material.storage_bucket)
        .remove([material.storage_path]);

      if (storageError) {
        throw new Error(storageError.message);
      }
    }

    const { error: deleteError } = await supabase
      .from("materials")
      .delete()
      .eq("owner_key", ownerKey)
      .eq("id", materialId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    return jsonOk({ deleted: true, materialId, sessionId: material.session_id });
  } catch (error) {
    return jsonError("Unable to delete material.", 500, getErrorMessage(error));
  }
}
