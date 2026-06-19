import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

const supabaseUrl = env.PUBLIC_SUPABASE_URL;
const supabasePublishableKey = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const publicSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

function createPublicClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabasePublishableKey) return null;

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export const supabase = createPublicClient();
