import { supabase } from '$lib/supabase';
import type { InsightsPayload, PopularityStripRow } from '$lib/types';

/** The profile's daily insights cache, or null before its first build. */
export async function getPublicProfileInsights(slug: string): Promise<InsightsPayload | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('public_profile_insights')
    .select('payload')
    .eq('slug', slug)
    .maybeSingle<{ payload: InsightsPayload }>();

  if (error) throw new Error(error.message);
  return data?.payload ?? null;
}

/** Every public profile's all-time score, for the comparison strip. */
export async function getPopularityStrip(): Promise<PopularityStripRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('public_profile_insights')
    .select('slug,display_name,all_time:payload->popularity->all_time')
    .order('display_name', { ascending: true })
    .returns<PopularityStripRow[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}
