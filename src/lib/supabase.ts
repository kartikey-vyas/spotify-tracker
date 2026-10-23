import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

export const supabaseUrl = env.PUBLIC_SUPABASE_URL;
export const supabasePublishableKey = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.PUBLIC_SUPABASE_ANON_KEY;

export const publicSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

function createPublicClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabasePublishableKey) return null;

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    }
  });
}

export const supabase = createPublicClient();
