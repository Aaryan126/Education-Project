import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

let adminClient: SupabaseClient | null | undefined;

export function getSupabaseStorageBucket() {
  return getEnv().SUPABASE_STORAGE_BUCKET;
}

export function getSupabaseOwnerKey() {
  return getEnv().SUPABASE_OWNER_KEY;
}

export function getSupabaseAdmin() {
  if (adminClient !== undefined) {
    return adminClient;
  }

  const env = getEnv();
  const elevatedKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  if (!env.SUPABASE_URL || !elevatedKey) {
    adminClient = null;
    return adminClient;
  }

  adminClient = createClient(env.SUPABASE_URL, elevatedKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return adminClient;
}

export function isSupabaseConfigured() {
  return getSupabaseAdmin() !== null;
}
