import { supabase } from '$lib/supabase';
import { publicOverviewToDiagnosticsRow, type SyncDiagnosticsRow } from '$lib/adminDiagnostics';
import { getPublicProfileOverview } from './overview';
import { listPublicProfiles } from './profile';

type AdminMarker = {
  user_id: string;
};

type AdminProfileRow = {
  user_id: string;
  slug: string;
  display_name: string;
  is_public: boolean;
};

type AdminSyncStateRow = {
  user_id: string | null;
  recently_played_cursor_ms: number | null;
  recently_played_last_success_at: string | null;
  recently_played_last_error_at: string | null;
  recently_played_last_error: string | null;
  recently_played_gap_risk: boolean;
  latest_exact_export_event_at: string | null;
  api_only_period_start: string | null;
  updated_at: string | null;
};

export async function isCurrentUserAdmin(): Promise<boolean> {
  if (!supabase) return false;

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) return false;

  const { data, error } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle<AdminMarker>();

  if (error) return false;
  return Boolean(data);
}

export async function getAdminSyncDiagnostics(): Promise<SyncDiagnosticsRow[]> {
  if (!supabase) return [];

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('user_id,slug,display_name,is_public')
    .order('display_name', { ascending: true })
    .returns<AdminProfileRow[]>();

  if (profileError) throw new Error(profileError.message);

  const { data: syncStates, error: syncError } = await supabase
    .from('sync_state')
    .select(
      'user_id,recently_played_cursor_ms,recently_played_last_success_at,recently_played_last_error_at,recently_played_last_error,recently_played_gap_risk,latest_exact_export_event_at,api_only_period_start,updated_at'
    )
    .returns<AdminSyncStateRow[]>();

  if (syncError) throw new Error(syncError.message);

  const profilesByUserId = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));

  return (syncStates ?? [])
    .filter((state) => state.user_id)
    .map((state) => {
      const profile = state.user_id ? profilesByUserId.get(state.user_id) : undefined;
      return {
        source: 'admin' as const,
        user_id: state.user_id,
        slug: profile?.slug ?? null,
        display_name: profile?.display_name ?? state.user_id ?? 'unknown user',
        is_public: profile?.is_public ?? null,
        gap_risk: state.recently_played_gap_risk,
        recently_played_cursor_ms: state.recently_played_cursor_ms,
        recently_played_last_success_at: state.recently_played_last_success_at,
        recently_played_last_error_at: state.recently_played_last_error_at,
        recently_played_last_error: state.recently_played_last_error,
        latest_exact_export_event_at: state.latest_exact_export_event_at,
        api_only_period_start: state.api_only_period_start,
        updated_at: state.updated_at
      };
    })
    .sort((a, b) => Number(b.gap_risk) - Number(a.gap_risk) || a.display_name.localeCompare(b.display_name));
}

export async function getPublicSyncDiagnostics(): Promise<SyncDiagnosticsRow[]> {
  const profiles = await listPublicProfiles();
  const rows = await Promise.all(
    profiles.map(async (profile) => {
      const overview = await getPublicProfileOverview(profile.slug);
      return overview ? publicOverviewToDiagnosticsRow(profile, overview) : null;
    })
  );

  return rows
    .filter((row): row is SyncDiagnosticsRow => row !== null)
    .sort((a, b) => Number(b.gap_risk) - Number(a.gap_risk) || a.display_name.localeCompare(b.display_name));
}
