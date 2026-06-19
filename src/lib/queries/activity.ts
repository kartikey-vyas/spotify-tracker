import { supabase } from '$lib/supabase';
import type { ActivityRow } from '$lib/types';

export async function getRecentActivity(limit = 100): Promise<ActivityRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('public_activity_recent')
    .select('*')
    .order('played_at', { ascending: false })
    .limit(limit)
    .returns<ActivityRow[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}
