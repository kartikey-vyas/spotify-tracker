import { pathToFileURL } from 'node:url';
import {
  createServiceClient,
  refreshUserPublicStats,
  throwIfSupabaseError,
  type AdminClient
} from './lib/supabase-admin.js';
import {
  getByIdOrNull,
  refreshSpotifyAccessToken,
  type SpotifyAlbum,
  type SpotifyArtist,
  type SpotifySimplifiedArtist,
  type SpotifyTrack
} from './lib/spotify.js';
import { upsertAlbumFromSpotify, upsertArtistFromSpotify } from './lib/spotify-dimensions.js';

const USER = '6873a96d-3c4a-49a2-b487-1e7a78226280';

type UnenrichedTrack = { id: number; spotify_track_id: string };

function parseFlag(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const value = Number(arg.slice(name.length + 3));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Order unenriched tracks by most-recent play. `events` must be sorted by
 * played_at descending; the first time a track id appears is its latest play.
 */
export function orderUnenrichedByRecency(
  eventsDesc: Array<{ track_id: number | null }>,
  unenriched: Map<number, UnenrichedTrack>
): UnenrichedTrack[] {
  const ordered: UnenrichedTrack[] = [];
  const seen = new Set<number>();
  for (const ev of eventsDesc) {
    const id = ev.track_id;
    if (id == null || seen.has(id)) continue;
    const track = unenriched.get(id);
    if (!track) continue;
    seen.add(id);
    ordered.push(track);
    if (ordered.length === unenriched.size) break;
  }
  return ordered;
}

async function pool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

/** Memoize a per-key resolver so the same id is only written once, even under concurrency. */
function memoize<T, R>(fn: (value: T) => Promise<R>, keyOf: (value: T) => string): (value: T) => Promise<R> {
  const cache = new Map<string, Promise<R>>();
  return (value: T) => {
    const key = keyOf(value);
    let hit = cache.get(key);
    if (!hit) {
      hit = fn(value);
      cache.set(key, hit);
    }
    return hit;
  };
}

async function loadUnenrichedTracks(supabase: AdminClient): Promise<Map<number, UnenrichedTrack>> {
  const map = new Map<number, UnenrichedTrack>();
  const total =
    (
      await supabase
        .from('tracks')
        .select('*', { count: 'exact', head: true })
        .not('spotify_track_id', 'is', null)
        .is('last_refreshed_at', null)
    ).count ?? 0;
  for (let from = 0; from < total; from += 1000) {
    const { data, error } = await supabase
      .from('tracks')
      .select('id, spotify_track_id')
      .not('spotify_track_id', 'is', null)
      .is('last_refreshed_at', null)
      .range(from, from + 999);
    throwIfSupabaseError(error, 'Loading unenriched tracks failed');
    for (const row of (data ?? []) as UnenrichedTrack[]) map.set(row.id, row);
  }
  return map;
}

async function loadRecencyOrder(
  supabase: AdminClient,
  unenriched: Map<number, UnenrichedTrack>
): Promise<UnenrichedTrack[]> {
  const total =
    (await supabase.from('listening_events').select('*', { count: 'exact', head: true }).eq('user_id', USER)).count ?? 0;
  const ordered: UnenrichedTrack[] = [];
  const seen = new Set<number>();
  for (let from = 0; from < total; from += 1000) {
    const { data, error } = await supabase
      .from('listening_events')
      .select('track_id')
      .eq('user_id', USER)
      .order('played_at', { ascending: false })
      .range(from, from + 999);
    throwIfSupabaseError(error, 'Loading recency order failed');
    for (const ev of (data ?? []) as Array<{ track_id: number | null }>) {
      const id = ev.track_id;
      if (id == null || seen.has(id)) continue;
      const track = unenriched.get(id);
      if (!track) continue;
      seen.add(id);
      ordered.push(track);
    }
    if (ordered.length === unenriched.size) break;
  }
  return ordered;
}

export async function main(): Promise<void> {
  const concurrency = parseFlag('concurrency', 6);
  const limit = parseFlag('limit', Number.POSITIVE_INFINITY);
  const skipRefresh = process.argv.includes('--no-refresh');

  const supabase = createServiceClient();

  // The client-credentials token lasts ~1h; a full run is longer, so refresh it
  // proactively. Guarded so concurrent workers trigger at most one refresh.
  let token = await refreshSpotifyAccessToken();
  let tokenFetchedAt = Date.now();
  let refreshing: Promise<void> | null = null;
  const currentToken = async (): Promise<string> => {
    if (Date.now() - tokenFetchedAt > 40 * 60 * 1000) {
      if (!refreshing) {
        refreshing = (async () => {
          token = await refreshSpotifyAccessToken();
          tokenFetchedAt = Date.now();
          refreshing = null;
        })();
      }
      await refreshing;
    }
    return token;
  };

  const unenriched = await loadUnenrichedTracks(supabase);
  let worklist = await loadRecencyOrder(supabase, unenriched);
  if (Number.isFinite(limit)) worklist = worklist.slice(0, limit);
  console.log(`Unenriched tracks: ${unenriched.size}; processing ${worklist.length} (concurrency ${concurrency})`);

  const resolveAlbum = memoize(
    (album: SpotifyAlbum) => upsertAlbumFromSpotify(supabase, album),
    (album) => album.id
  );
  const resolveArtist = memoize(
    (artist: SpotifyArtist | SpotifySimplifiedArtist) => upsertArtistFromSpotify(supabase, artist),
    (artist) => artist.id
  );

  const affectedDates = new Set<string>();
  let done = 0;
  let missing = 0;
  let failed = 0;
  let aborted = false;

  // Fetch a track, refreshing the token once on a 401 (expired mid-run).
  const fetchTrack = async (spotifyId: string): Promise<SpotifyTrack | null> => {
    try {
      return await getByIdOrNull<SpotifyTrack>(`/v1/tracks/${spotifyId}`, await currentToken());
    } catch (error) {
      if ((error as { status?: number }).status === 401) {
        tokenFetchedAt = 0; // force a refresh on the next currentToken()
        return getByIdOrNull<SpotifyTrack>(`/v1/tracks/${spotifyId}`, await currentToken());
      }
      throw error;
    }
  };

  await pool(worklist, concurrency, async (track) => {
    if (aborted) return;
    try {
      const spotifyTrack = await fetchTrack(track.spotify_track_id);
      if (!spotifyTrack) {
        // Mark as refreshed so a 404 id doesn't get retried forever.
        await supabase.from('tracks').update({ last_refreshed_at: new Date().toISOString() }).eq('id', track.id);
        missing += 1;
        return;
      }

      const albumId = spotifyTrack.album ? await resolveAlbum(spotifyTrack.album) : null;
      const artistIds: number[] = [];
      for (const artist of spotifyTrack.artists ?? []) artistIds.push(await resolveArtist(artist));

      const { error: trackError } = await supabase
        .from('tracks')
        .update({
          name: spotifyTrack.name,
          album_id: albumId,
          duration_ms: spotifyTrack.duration_ms ?? null,
          explicit: spotifyTrack.explicit ?? null,
          isrc: spotifyTrack.external_ids?.isrc ?? null,
          spotify_url: spotifyTrack.external_urls?.spotify ?? null,
          last_refreshed_at: new Date().toISOString()
        })
        .eq('id', track.id);
      throwIfSupabaseError(trackError, 'Updating enriched track failed');

      if (artistIds.length > 0) {
        const { error: taError } = await supabase.from('track_artists').upsert(
          artistIds.map((artistId, index) => ({ track_id: track.id, artist_id: artistId, artist_order: index })),
          { onConflict: 'track_id,artist_id' }
        );
        throwIfSupabaseError(taError, 'Upserting enriched track artists failed');
      }

      const primaryArtistId = artistIds[0] ?? null;
      const { data: updatedEvents, error: evError } = await supabase
        .from('listening_events')
        .update({ album_id: albumId, primary_artist_id: primaryArtistId })
        .eq('user_id', USER)
        .eq('track_id', track.id)
        .select('local_date');
      throwIfSupabaseError(evError, 'Repointing enriched events failed');
      for (const row of (updatedEvents ?? []) as Array<{ local_date: string }>) affectedDates.add(row.local_date);

      done += 1;
      if (done % 250 === 0) console.log(`  enriched ${done}/${worklist.length} (missing ${missing}, failed ${failed})`);
    } catch (error) {
      failed += 1;
      // Daily/abuse rate cap — stop the whole run rather than hammer Spotify.
      if ((error as { status?: number }).status === 429) {
        if (!aborted) console.error('Hit Spotify daily rate cap — aborting run; re-run later to resume.');
        aborted = true;
        return;
      }
      console.warn(`track ${track.spotify_track_id} failed: ${error instanceof Error ? error.message : error}`);
    }
  });

  console.log(
    `${aborted ? 'ABORTED (rate cap). ' : ''}Enriched ${done}, missing(404) ${missing}, failed ${failed}. Affected dates: ${affectedDates.size}`
  );

  if (!skipRefresh && affectedDates.size > 0) {
    const dates = [...affectedDates].sort();
    console.log(`Refreshing rollups for ${dates.length} dates in chunks of 300...`);
    for (let i = 0; i < dates.length; i += 300) {
      await refreshUserPublicStats(supabase, USER, dates.slice(i, i + 300));
      console.log(`  refreshed ${Math.min(i + 300, dates.length)}/${dates.length}`);
    }
  }
  console.log('Done.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
