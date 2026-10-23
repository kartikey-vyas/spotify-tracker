import { supabase } from '$lib/supabase';
import { coverVariant } from '$lib/covers';
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

  // The thumbnails are 32-40px, so Spotify's 300px art is plenty.
  return rows.map((row) => {
    const url = row.album_id != null ? images.get(row.album_id)?.image_url : null;
    return { ...row, album_image_url: url ? coverVariant(url, 'medium') : null };
  });
}
