import { supabase } from '$lib/supabase';
import { mapRpcRankingRow, type RpcRankingRow } from '$lib/queries/rankings';
import type { RankingRow } from '$lib/types';

/* The homepage band (top artists, top tracks and the cover wall) in one round
   trip. See supabase/migrations/20261023100000_public_profile_home_band.sql. */

export const HOME_BAND_LIST_LIMIT = 8;
// Enough albums to fill complete rows at any width; CoverWall trims to whole
// rows for the current column count.
export const HOME_BAND_ALBUM_LIMIT = 36;

export type HomeBandAlbum = RankingRow & {
  image_url: string | null;
  artist_name: string | null;
};

export type HomeBand = {
  artists: RankingRow[];
  tracks: RankingRow[];
  albums: HomeBandAlbum[];
};

type RawHomeBand = {
  artists?: RpcRankingRow[] | null;
  tracks?: RpcRankingRow[] | null;
  albums?: Array<RpcRankingRow & { image_url?: string | null; artist_name?: string | null }> | null;
};

/** Shapes the RPC's JSON. Shared by the live call and the boot-script prefetch. */
export function parseHomeBand(raw: unknown): HomeBand {
  const band = (raw ?? {}) as RawHomeBand;
  return {
    artists: (band.artists ?? []).map(mapRpcRankingRow),
    tracks: (band.tracks ?? []).map(mapRpcRankingRow),
    albums: (band.albums ?? []).map((row) => ({
      ...mapRpcRankingRow(row),
      image_url: row.image_url ?? null,
      artist_name: row.artist_name ?? null
    }))
  };
}

export async function getHomeBand(params: { slug: string; start: string; end: string }): Promise<HomeBand> {
  if (!supabase) return { artists: [], tracks: [], albums: [] };

  const { data, error } = await supabase.rpc('public_profile_home_band', {
    p_slug: params.slug,
    p_start_date: params.start,
    p_end_date: params.end,
    p_list_limit: HOME_BAND_LIST_LIMIT,
    p_album_limit: HOME_BAND_ALBUM_LIMIT
  });

  if (error) throw new Error(error.message);
  return parseHomeBand(data);
}
