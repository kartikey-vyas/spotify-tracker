import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  createServiceClient,
  refreshUserPublicStats,
  throwIfSupabaseError,
  type AdminClient
} from './lib/supabase-admin.js';
import { localDateFor, uniqueSortedDates, unixMs } from './lib/dates.js';
import { sha256 } from './lib/hash.js';
import { spotifyIdFromUri } from './lib/spotify.js';

type ExportRow = {
  ts: string;
  platform?: string | null;
  ms_played?: number | null;
  master_metadata_track_name?: string | null;
  master_metadata_album_artist_name?: string | null;
  master_metadata_album_album_name?: string | null;
  spotify_track_uri?: string | null;
  episode_name?: string | null;
  episode_show_name?: string | null;
  spotify_episode_uri?: string | null;
  reason_start?: string | null;
  reason_end?: string | null;
  shuffle?: boolean | null;
  skipped?: boolean | null;
  offline?: boolean | null;
  incognito_mode?: boolean | null;
};

type IdRow = { id: number };

const SOURCE_EXPORT = 1;
const QUALITY_EXACT = 1;

const artistCache = new Map<string, number>();
const albumCache = new Map<string, number>();
const trackCache = new Map<string, number>();

function usage(): never {
  throw new Error('Usage: pnpm import:spotify-export --user-id=<auth-user-uuid> ./analysis/out/cleaned_*.json');
}

export type ImportArgs = {
  targetUserId: string;
  files: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseImportArgs(args: string[]): ImportArgs {
  const userIdArgs = args.filter((arg) => arg.startsWith('--user-id='));
  if (userIdArgs.length !== 1) usage();

  const targetUserId = userIdArgs[0]?.slice('--user-id='.length).trim();
  if (!targetUserId || !UUID_RE.test(targetUserId)) usage();

  const files = args.filter((arg) => !arg.startsWith('--user-id='));
  if (files.length === 0) usage();

  return { targetUserId, files };
}

function normalizeName(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function sourceEventKey(row: ExportRow): string {
  return sha256([
    'export',
    row.ts,
    row.spotify_track_uri,
    row.spotify_episode_uri,
    row.ms_played,
    row.platform,
    row.reason_start,
    row.reason_end
  ]);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function refreshImportedDates(
  supabase: AdminClient,
  targetUserId: string,
  affectedDates: Set<string>
): Promise<void> {
  const dates = uniqueSortedDates(affectedDates);
  if (dates.length === 0) return;
  await refreshUserPublicStats(supabase, targetUserId, dates);
}

async function getOrCreateNamedRow(
  supabase: AdminClient,
  table: 'artists' | 'albums',
  cache: Map<string, number>,
  name: string
): Promise<number> {
  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const spotifyIdColumn = table === 'artists' ? 'spotify_artist_id' : 'spotify_album_id';
  const spotifyUriColumn = table === 'artists' ? 'spotify_artist_uri' : 'spotify_album_uri';

  const { data: existing, error: existingError } = await supabase
    .from(table)
    .select('id')
    .is(spotifyIdColumn, null)
    .is(spotifyUriColumn, null)
    .eq('name', name)
    .maybeSingle<IdRow>();
  throwIfSupabaseError(existingError, `Looking up ${table} fallback row failed`);

  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }

  const { data, error } = await supabase.from(table).insert({ name }).select('id').single<IdRow>();
  throwIfSupabaseError(error, `Inserting ${table} fallback row failed`);
  if (!data) throw new Error(`Inserting ${table} fallback row returned no data`);
  cache.set(key, data.id);
  return data.id;
}

async function upsertTrack(
  supabase: AdminClient,
  trackName: string,
  trackUri: string,
  albumId: number | null
): Promise<number> {
  const cached = trackCache.get(trackUri);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('tracks')
    .upsert(
      {
        spotify_track_uri: trackUri,
        spotify_track_id: spotifyIdFromUri(trackUri),
        name: trackName,
        album_id: albumId
      },
      { onConflict: 'spotify_track_uri' }
    )
    .select('id')
    .single<IdRow>();
  throwIfSupabaseError(error, 'Upserting export track failed');
  if (!data) throw new Error('Upserting export track returned no data');

  trackCache.set(trackUri, data.id);
  return data.id;
}

export async function main(args = process.argv.slice(2), supabase = createServiceClient()): Promise<void> {
  const { targetUserId, files } = parseImportArgs(args);

  const events = [];
  const trackArtists = [];
  const affectedDates = new Set<string>();
  let rowsRead = 0;
  let skippedPodcastRows = 0;
  let skippedRowsWithoutTrackUri = 0;
  let latestExactMs = 0;

  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as ExportRow[];
    if (!Array.isArray(parsed)) {
      throw new Error(`${file} did not contain a JSON array`);
    }

    for (const row of parsed) {
      rowsRead += 1;

      if (row.spotify_episode_uri || row.episode_name || row.episode_show_name) {
        skippedPodcastRows += 1;
        continue;
      }

      if (!row.spotify_track_uri) {
        skippedRowsWithoutTrackUri += 1;
        continue;
      }

      const artistName = normalizeName(row.master_metadata_album_artist_name, 'Unknown Artist');
      const albumName = normalizeName(row.master_metadata_album_album_name, 'Unknown Album');
      const trackName = normalizeName(row.master_metadata_track_name, 'Unknown Track');
      const artistId = await getOrCreateNamedRow(supabase, 'artists', artistCache, artistName);
      const albumId = await getOrCreateNamedRow(supabase, 'albums', albumCache, albumName);
      const trackId = await upsertTrack(supabase, trackName, row.spotify_track_uri, albumId);
      const playedAtMs = unixMs(row.ts);
      const localDate = localDateFor(row.ts);

      latestExactMs = Math.max(latestExactMs, playedAtMs);
      affectedDates.add(localDate);
      trackArtists.push({
        track_id: trackId,
        artist_id: artistId,
        artist_order: 0
      });
      events.push({
        user_id: targetUserId,
        played_at: new Date(playedAtMs).toISOString(),
        local_date: localDate,
        source: SOURCE_EXPORT,
        data_quality: QUALITY_EXACT,
        track_id: trackId,
        primary_artist_id: artistId,
        album_id: albumId,
        ms_played: row.ms_played ?? 0,
        skipped: row.skipped ?? null,
        reason_start: row.reason_start ?? null,
        reason_end: row.reason_end ?? null,
        shuffle: row.shuffle ?? null,
        offline: row.offline ?? null,
        private_session: row.incognito_mode ?? null,
        source_event_key: sourceEventKey(row)
      });
    }
  }

  for (const batch of chunk(trackArtists, 1000)) {
    const { error } = await supabase
      .from('track_artists')
      .upsert(batch, { onConflict: 'track_id,artist_id' });
    throwIfSupabaseError(error, 'Upserting export track artists failed');
  }

  for (const batch of chunk(events, 1000)) {
    const { error } = await supabase
      .from('listening_events')
      .upsert(batch, {
        onConflict: 'user_id,source_event_key',
        ignoreDuplicates: true
      });
    throwIfSupabaseError(error, 'Inserting export listening events failed');
  }

  if (latestExactMs > 0) {
    const latestExactIso = new Date(latestExactMs).toISOString();
    const stateUpdate = {
      id: 1,
      user_id: targetUserId,
      latest_exact_export_event_at: latestExactIso,
      api_only_period_start: latestExactIso,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from('sync_state').upsert(stateUpdate, { onConflict: 'user_id' });
    throwIfSupabaseError(error, 'Updating sync_state after import failed');
  }

  await refreshImportedDates(supabase, targetUserId, affectedDates);

  console.log(
    JSON.stringify(
      {
        rows_read: rowsRead,
        events_attempted: events.length,
        user_id: targetUserId,
        affected_dates: uniqueSortedDates(affectedDates).length,
        skipped_podcast_rows: skippedPodcastRows,
        skipped_rows_without_track_uri: skippedRowsWithoutTrackUri
      },
      null,
      2
    )
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
