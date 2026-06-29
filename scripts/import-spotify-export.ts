import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  createServiceClient,
  refreshUserPublicStats,
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

type PendingRow = {
  row: ExportRow;
  trackUri: string;
  artistKey: string;
  albumKey: string;
};

export type ImportPlan = {
  /** lowercased name -> representative original-case name */
  artistNames: Map<string, string>;
  albumNames: Map<string, string>;
  /** track uri -> name + lowercased album key (from first occurrence) */
  tracks: Map<string, { name: string; albumKey: string }>;
  pending: PendingRow[];
  rowsRead: number;
  skippedPodcastRows: number;
  skippedRowsWithoutTrackUri: number;
};

export type ResolvedIds = {
  artistIdByName: Map<string, number>;
  albumIdByName: Map<string, number>;
  trackIdByUri: Map<string, number>;
};

type TrackArtistInsert = { track_id: number; artist_id: number; artist_order: number };

type EventInsert = {
  user_id: string;
  played_at: string;
  local_date: string;
  source: number;
  data_quality: number;
  track_id: number;
  primary_artist_id: number;
  album_id: number | null;
  ms_played: number;
  skipped: boolean | null;
  reason_start: string | null;
  reason_end: string | null;
  shuffle: boolean | null;
  offline: boolean | null;
  private_session: boolean | null;
  source_event_key: string;
};

export type AssembledEvents = {
  events: EventInsert[];
  trackArtists: TrackArtistInsert[];
  affectedDates: Set<string>;
  latestExactMs: number;
};

const SOURCE_EXPORT = 1;
const QUALITY_EXACT = 1;

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|timeout|aborted|\b50[234]\b|\b429\b/i.test(
    message
  );
}

/**
 * Run a Supabase query thunk with retry/backoff on transient network failures.
 * The thunk must rebuild the query each call so retries use a fresh request.
 */
async function runQuery<T>(
  label: string,
  build: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
  attempts = 6
): Promise<T | null> {
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { data, error } = await build();
      if (!error) return data;
      lastError = error.message;
      if (!isTransient(error.message) || attempt === attempts) {
        throw new Error(`${label}: ${error.message}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (!isTransient(error) || attempt === attempts) {
        throw error instanceof Error ? error : new Error(lastError);
      }
    }
    const waitMs = Math.min(1000 * 2 ** (attempt - 1), 15000);
    console.warn(`${label} transient failure (attempt ${attempt}/${attempts}): ${lastError}; retrying in ${waitMs}ms`);
    await sleep(waitMs);
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError}`);
}

export async function refreshImportedDates(
  supabase: AdminClient,
  targetUserId: string,
  affectedDates: Set<string>
): Promise<void> {
  const dates = uniqueSortedDates(affectedDates);
  if (dates.length === 0) return;
  for (const batch of chunk(dates, 1000)) {
    await refreshUserPublicStats(supabase, targetUserId, batch);
  }
}

/** Build the in-memory plan (unique dimensions + per-row work) from raw export rows. */
export function buildImportPlan(rows: ExportRow[]): ImportPlan {
  const artistNames = new Map<string, string>();
  const albumNames = new Map<string, string>();
  const tracks = new Map<string, { name: string; albumKey: string }>();
  const pending: PendingRow[] = [];
  let rowsRead = 0;
  let skippedPodcastRows = 0;
  let skippedRowsWithoutTrackUri = 0;

  for (const row of rows) {
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
    const artistKey = artistName.toLowerCase();
    const albumKey = albumName.toLowerCase();

    if (!artistNames.has(artistKey)) artistNames.set(artistKey, artistName);
    if (!albumNames.has(albumKey)) albumNames.set(albumKey, albumName);
    if (!tracks.has(row.spotify_track_uri)) {
      tracks.set(row.spotify_track_uri, { name: trackName, albumKey });
    }

    pending.push({ row, trackUri: row.spotify_track_uri, artistKey, albumKey });
  }

  return { artistNames, albumNames, tracks, pending, rowsRead, skippedPodcastRows, skippedRowsWithoutTrackUri };
}

/** Assemble listening_events + track_artists rows from resolved dimension ids. */
export function assembleEvents(
  pending: PendingRow[],
  targetUserId: string,
  ids: ResolvedIds
): AssembledEvents {
  const events: EventInsert[] = [];
  const trackArtists: TrackArtistInsert[] = [];
  const trackArtistKeys = new Set<string>();
  const affectedDates = new Set<string>();
  let latestExactMs = 0;

  for (const item of pending) {
    const trackId = ids.trackIdByUri.get(item.trackUri);
    const artistId = ids.artistIdByName.get(item.artistKey);
    if (trackId === undefined || artistId === undefined) {
      throw new Error(`Missing resolved id for track ${item.trackUri}`);
    }
    const albumId = ids.albumIdByName.get(item.albumKey) ?? null;

    const trackArtistKey = `${trackId}:${artistId}`;
    if (!trackArtistKeys.has(trackArtistKey)) {
      trackArtistKeys.add(trackArtistKey);
      trackArtists.push({ track_id: trackId, artist_id: artistId, artist_order: 0 });
    }

    const playedAtMs = unixMs(item.row.ts);
    const localDate = localDateFor(item.row.ts);
    latestExactMs = Math.max(latestExactMs, playedAtMs);
    affectedDates.add(localDate);

    events.push({
      user_id: targetUserId,
      played_at: new Date(playedAtMs).toISOString(),
      local_date: localDate,
      source: SOURCE_EXPORT,
      data_quality: QUALITY_EXACT,
      track_id: trackId,
      primary_artist_id: artistId,
      album_id: albumId,
      ms_played: item.row.ms_played ?? 0,
      skipped: item.row.skipped ?? null,
      reason_start: item.row.reason_start ?? null,
      reason_end: item.row.reason_end ?? null,
      shuffle: item.row.shuffle ?? null,
      offline: item.row.offline ?? null,
      private_session: item.row.incognito_mode ?? null,
      source_event_key: sourceEventKey(item.row)
    });
  }

  return { events, trackArtists, affectedDates, latestExactMs };
}

/**
 * Resolve name-fallback dimension rows (artists/albums) in bulk: page through
 * existing fallback rows, then batch-insert any missing names. Keyed on
 * lowercased name to match the `lower(name)` partial unique index.
 */
async function resolveFallbackIds(
  supabase: AdminClient,
  table: 'artists' | 'albums',
  names: Map<string, string>
): Promise<Map<string, number>> {
  const uriColumn = table === 'artists' ? 'spotify_artist_uri' : 'spotify_album_uri';
  const idColumn = table === 'artists' ? 'spotify_artist_id' : 'spotify_album_id';

  const idByName = new Map<string, number>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const rows = await runQuery<Array<{ id: number; name: string }>>(`Loading ${table} fallback rows`, () =>
      supabase
        .from(table)
        .select('id, name')
        .is(uriColumn, null)
        .is(idColumn, null)
        .range(from, from + pageSize - 1)
    );
    for (const row of rows ?? []) {
      const key = row.name.toLowerCase();
      if (!idByName.has(key)) idByName.set(key, row.id);
    }
    if (!rows || rows.length < pageSize) break;
  }

  const missing = [...names.entries()].filter(([key]) => !idByName.has(key));
  for (const batch of chunk(missing, 500)) {
    const inserted = await runQuery<Array<{ id: number; name: string }>>(`Inserting ${table} fallback rows`, () =>
      supabase
        .from(table)
        .insert(batch.map(([, original]) => ({ name: original })))
        .select('id, name')
    );
    for (const row of inserted ?? []) {
      idByName.set(row.name.toLowerCase(), row.id);
    }
  }

  return idByName;
}

/** Upsert tracks in bulk on spotify_track_uri and return uri -> id. */
async function resolveTrackIds(
  supabase: AdminClient,
  tracks: Map<string, { name: string; albumKey: string }>,
  albumIdByName: Map<string, number>
): Promise<Map<string, number>> {
  const idByUri = new Map<string, number>();
  for (const batch of chunk([...tracks.entries()], 500)) {
    const payload = batch.map(([uri, track]) => ({
      spotify_track_uri: uri,
      spotify_track_id: spotifyIdFromUri(uri),
      name: track.name,
      album_id: albumIdByName.get(track.albumKey) ?? null
    }));
    const rows = await runQuery<Array<{ id: number; spotify_track_uri: string }>>('Upserting export tracks', () =>
      supabase.from('tracks').upsert(payload, { onConflict: 'spotify_track_uri' }).select('id, spotify_track_uri')
    );
    for (const row of rows ?? []) {
      idByUri.set(row.spotify_track_uri, row.id);
    }
  }
  return idByUri;
}

export async function main(args = process.argv.slice(2), supabase = createServiceClient()): Promise<void> {
  const { targetUserId, files } = parseImportArgs(args);

  const allRows: ExportRow[] = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as ExportRow[];
    if (!Array.isArray(parsed)) {
      throw new Error(`${file} did not contain a JSON array`);
    }
    allRows.push(...parsed);
  }

  const plan = buildImportPlan(allRows);

  // Albums before tracks (tracks reference album ids); artists independently.
  const albumIdByName = await resolveFallbackIds(supabase, 'albums', plan.albumNames);
  const artistIdByName = await resolveFallbackIds(supabase, 'artists', plan.artistNames);
  const trackIdByUri = await resolveTrackIds(supabase, plan.tracks, albumIdByName);

  const { events, trackArtists, affectedDates, latestExactMs } = assembleEvents(plan.pending, targetUserId, {
    artistIdByName,
    albumIdByName,
    trackIdByUri
  });

  for (const batch of chunk(trackArtists, 1000)) {
    await runQuery('Upserting export track artists', () =>
      supabase.from('track_artists').upsert(batch, { onConflict: 'track_id,artist_id' })
    );
  }

  for (const batch of chunk(events, 1000)) {
    await runQuery('Inserting export listening events', () =>
      supabase
        .from('listening_events')
        .upsert(batch, { onConflict: 'user_id,source_event_key', ignoreDuplicates: true })
    );
  }

  if (latestExactMs > 0) {
    const latestExactIso = new Date(latestExactMs).toISOString();
    await runQuery('Updating sync_state after import', () =>
      supabase.from('sync_state').upsert(
        {
          id: 1,
          user_id: targetUserId,
          latest_exact_export_event_at: latestExactIso,
          api_only_period_start: latestExactIso,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      )
    );
  }

  await refreshImportedDates(supabase, targetUserId, affectedDates);

  console.log(
    JSON.stringify(
      {
        rows_read: plan.rowsRead,
        events_attempted: events.length,
        user_id: targetUserId,
        unique_tracks: plan.tracks.size,
        unique_artists: plan.artistNames.size,
        unique_albums: plan.albumNames.size,
        affected_dates: uniqueSortedDates(affectedDates).length,
        skipped_podcast_rows: plan.skippedPodcastRows,
        skipped_rows_without_track_uri: plan.skippedRowsWithoutTrackUri
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
