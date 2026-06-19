import { supabase } from '$lib/supabase';

export type AlbumImage = {
  name: string;
  image_url: string | null;
  spotify_url: string | null;
};

/**
 * Resolve album cover art (and metadata) for a set of album ids.
 * Album art lives in `albums.image_url`, which is publicly readable by the anon client.
 * Returns a map keyed by album id; albums without a row or without art are simply absent.
 */
export async function fetchAlbumImages(albumIds: Array<number | null | undefined>): Promise<Map<number, AlbumImage>> {
  const result = new Map<number, AlbumImage>();
  if (!supabase) return result;

  const ids = [...new Set(albumIds.filter((id): id is number => typeof id === 'number'))];
  if (ids.length === 0) return result;

  const { data, error } = await supabase
    .from('albums')
    .select('id,name,image_url,spotify_url')
    .in('id', ids)
    .returns<Array<{ id: number; name: string; image_url: string | null; spotify_url: string | null }>>();

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    result.set(row.id, { name: row.name, image_url: row.image_url, spotify_url: row.spotify_url });
  }

  return result;
}
