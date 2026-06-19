import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './env.js';

export type AdminClient = SupabaseClient;

export function createServiceClient(): AdminClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function throwIfSupabaseError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

export async function refreshPublicStats(
  supabase: AdminClient,
  targetDates: string[] | null = null
): Promise<void> {
  const { error } = await supabase.rpc('refresh_public_stats', {
    target_dates: targetDates
  });
  throwIfSupabaseError(error, 'Refreshing public stats failed');
}
