import { supabase } from '$lib/supabase';
import { fetchAlbumImages } from '$lib/queries/images';
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

  const rows = data ?? [];
  const images = await fetchAlbumImages(rows.map((row) => row.album_id));

  return rows.map((row) => ({
    ...row,
    album_image_url: row.album_id != null ? (images.get(row.album_id)?.image_url ?? null) : null
  }));
}
