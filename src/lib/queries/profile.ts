import { supabase } from '$lib/supabase';
import type { Profile, PublicProfileOption, SpotifyConnectionStatus } from '$lib/types';

async function requireUserId(): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error('You must be signed in to update your profile');
  return userId;
}

export async function getCurrentProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,slug,display_name,is_public')
    .eq('user_id', userId)
    .maybeSingle<Profile>();

  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function getPublicProfile(slug: string): Promise<Profile | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,slug,display_name,is_public')
    .eq('slug', slug)
    .eq('is_public', true)
    .maybeSingle<Profile>();

  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function listPublicProfiles(): Promise<PublicProfileOption[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('public_profile_overview')
    .select('slug,display_name,generated_at')
    .order('display_name', { ascending: true })
    .returns<PublicProfileOption[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getSpotifyConnectionStatus(): Promise<SpotifyConnectionStatus | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('spotify_connections')
    .select(
      'user_id,spotify_user_id,spotify_display_name,scopes,sync_enabled,connected_at,last_token_refresh_at,last_error_at,last_error,updated_at'
    )
    .maybeSingle<SpotifyConnectionStatus>();

  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function updateProfilePublicFlag(isPublic: boolean): Promise<void> {
  if (!supabase) return;
  const userId = await requireUserId();

  const { error } = await supabase
    .from('profiles')
    .update({
      is_public: isPublic,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
}

export async function updateSpotifySyncEnabled(syncEnabled: boolean): Promise<void> {
  if (!supabase) return;
  const userId = await requireUserId();

  const { error } = await supabase
    .from('spotify_connections')
    .update({
      sync_enabled: syncEnabled,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
}
