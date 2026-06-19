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

export async function refreshUserPublicStats(
  supabase: AdminClient,
  userId: string,
  targetDates: string[] | null = null
): Promise<void> {
  const { error } = await supabase.rpc('refresh_user_public_stats', {
    p_user_id: userId,
    target_dates: targetDates
  });
  throwIfSupabaseError(error, 'Refreshing user public stats failed');
}

/**
 * Recompute per-user rollups for the given dates across every sync-enabled
 * connection. Genres/metadata written by enrichment only reach the daily
 * rollups (and therefore the overview cache) through this per-user path; the
 * legacy global refresh_public_stats is a no-op since the anonymous feed was
 * archived. Skips entirely when no dates changed to avoid a full rebuild.
 */
export async function refreshConnectedUsersPublicStats(
  supabase: AdminClient,
  targetDates: string[]
): Promise<void> {
  if (!targetDates || targetDates.length === 0) return;

  const { data, error } = await supabase
    .from('spotify_connections')
    .select('user_id')
    .eq('sync_enabled', true);
  throwIfSupabaseError(error, 'Loading connected users for stats refresh failed');

  for (const row of (data ?? []) as Array<{ user_id: string }>) {
    await refreshUserPublicStats(supabase, row.user_id, targetDates);
  }
}
