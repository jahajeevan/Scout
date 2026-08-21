// Supabase client (publishable/anon key — safe in the browser). Returns null if
// not configured, so callers degrade gracefully to localStorage. We never crash
// the app if Supabase is unreachable (spec §48 provider failures).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;
if (url && key) {
  client = createClient(url, key, { auth: { persistSession: false } });
}

export const supabase = client;
export const CONVERSATIONS_TABLE = "conversations";
