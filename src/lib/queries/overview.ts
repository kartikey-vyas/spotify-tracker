import { supabase } from '$lib/supabase';
import type { OverviewPayload } from '$lib/types';

export async function getOverview(): Promise<OverviewPayload | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('overview_cache')
    .select('payload')
    .eq('key', 'public_home')
    .maybeSingle<{ payload: OverviewPayload }>();

  if (error) throw new Error(error.message);
  return data?.payload ?? null;
}

export async function getUserOverview(userId: string): Promise<OverviewPayload | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('overview_cache')
    .select('payload')
    .eq('user_id', userId)
    .eq('key', `public_home:${userId}`)
    .maybeSingle<{ payload: OverviewPayload }>();

  if (error) throw new Error(error.message);
  return data?.payload ?? null;
}

export async function getPublicProfileOverview(slug: string): Promise<OverviewPayload | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('public_profile_overview')
    .select('payload')
    .eq('slug', slug)
    .maybeSingle<{ payload: OverviewPayload }>();

  if (error) throw new Error(error.message);
  return data?.payload ?? null;
}
