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

/**
 * Resolve each album's artist for a set of album ids. Albums don't store an
 * artist, so derive it from the album's tracks: for every stored track take its
 * primary artist (`track_artists.artist_order` 0), then keep the most frequent
 * per album — robust for single-artist albums and sensible for compilations.
 * Albums whose tracks aren't enriched yet are simply absent from the map.
 */
export async function fetchAlbumArtists(albumIds: Array<number | null | undefined>): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (!supabase) return result;

  const ids = [...new Set(albumIds.filter((id): id is number => typeof id === 'number'))];
  if (ids.length === 0) return result;

  const { data, error } = await supabase
    .from('tracks')
    .select('album_id,track_artists(artist_order,artists(name))')
    .in('album_id', ids)
    .returns<
      Array<{
        album_id: number | null;
        track_artists: Array<{ artist_order: number; artists: { name: string } | null }>;
      }>
    >();

  if (error) throw new Error(error.message);

  const tallies = new Map<number, Map<string, number>>();
  for (const track of data ?? []) {
    if (track.album_id == null) continue;
    const primary = [...track.track_artists].sort((left, right) => left.artist_order - right.artist_order)[0];
    const name = primary?.artists?.name;
    if (!name) continue;
    const tally = tallies.get(track.album_id) ?? new Map<string, number>();
    tally.set(name, (tally.get(name) ?? 0) + 1);
    tallies.set(track.album_id, tally);
  }

  for (const [albumId, tally] of tallies) {
    let best = '';
    let bestCount = 0;
    for (const [name, count] of tally) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    if (best) result.set(albumId, best);
  }

  return result;
}
