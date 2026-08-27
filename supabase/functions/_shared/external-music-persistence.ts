// The Edge runtime resolves `npm:` specifiers; the browser/test tsconfig does
// not, even though this import is erased at runtime.
// @ts-expect-error Deno-specific npm specifier.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { LastFmCapture } from './lastfm.ts';
import type { ScoredMusicBrainzRecording } from './musicbrainz.ts';
import { normalizeLastFmTag } from './external-music-enrichment.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SIMILAR_TRACKS = 20;

type JsonObject = Record<string, unknown>;
type EntityType = 'track' | 'artist' | 'album';

export type ExternalMusicWorkItem = {
  queue_id: number;
  worker_token: string;
  attempt_count: number;
  entity_type: EntityType;
  entity_id: number;
  entity_name: string;
  last_result: unknown;
  context_track_id: number;
  context_track_name: string;
  context_duration_ms: number | null;
  context_isrc: string;
  context_album_id: number | null;
  context_album_name: string | null;
  context_artists: Array<{ id: number; name: string; artist_order: number }>;
};

export type MusicBrainzWrite = {
  fetchedAt: string;
  candidates: ScoredMusicBrainzRecording[];
  selected: ScoredMusicBrainzRecording | null;
};

export type ProviderWrites = {
  musicbrainz?: MusicBrainzWrite;
  lastfm: Record<string, LastFmCapture>;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, key: string): JsonObject | null {
  if (!isObject(value)) return null;
  return isObject(value[key]) ? value[key] as JsonObject : null;
}

function arrayAt(value: unknown, key: string): unknown[] {
  if (!isObject(value)) return [];
  return Array.isArray(value[key]) ? value[key] as unknown[] : [];
}

function stringAt(value: unknown, key: string): string | null {
  if (!isObject(value)) return null;
  const child = value[key];
  return typeof child === 'string' && child.trim() ? child.trim() : null;
}

function nonnegativeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validTimestamp(value: string): string {
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : new Date(value).toISOString();
}

function entityColumn(kind: EntityType): 'track_id' | 'artist_id' | 'album_id' {
  return `${kind}_id` as 'track_id' | 'artist_id' | 'album_id';
}

function entityColumns(kind: EntityType, id: number): Record<string, number | null> {
  return {
    track_id: kind === 'track' ? id : null,
    artist_id: kind === 'artist' ? id : null,
    album_id: kind === 'album' ? id : null
  };
}

function payloadFor(kind: EntityType, capture: LastFmCapture): JsonObject | null {
  return objectAt(capture.data, kind);
}

function captureKey(kind: EntityType, suffix: 'info' | 'tags' | 'similar'): string {
  return `${kind}.${suffix}`;
}

function throwIfError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function metadataRow(item: ExternalMusicWorkItem, capture: LastFmCapture, payload: JsonObject) {
  const description = objectAt(payload, item.entity_type === 'artist' ? 'bio' : 'wiki');
  const embeddedArtist = objectAt(payload, 'artist');
  const matchMethod = capture.params.mbid
    ? 'mbid'
    : item.entity_type === 'artist'
      ? 'name_fallback'
      : 'name';
  return {
    source: 'lastfm',
    ...entityColumns(item.entity_type, item.entity_id),
    canonical_name: stringAt(payload, 'name') ?? stringAt(payload, 'title') ?? item.entity_name,
    canonical_artist_name: typeof payload.artist === 'string'
      ? payload.artist
      : stringAt(embeddedArtist, 'name'),
    source_url: stringAt(payload, 'url'),
    summary_html: stringAt(description, 'summary'),
    summary_published_at: stringAt(description, 'published'),
    match_method: matchMethod,
    fetched_at: validTimestamp(capture.fetched_at)
  };
}

function statsRow(item: ExternalMusicWorkItem, capture: LastFmCapture, payload: JsonObject) {
  const nestedStats = objectAt(payload, 'stats');
  const listeners = nonnegativeInteger(payload.listeners ?? nestedStats?.listeners);
  const playcount = nonnegativeInteger(payload.playcount ?? nestedStats?.playcount);
  if (listeners === null && playcount === null) return null;
  const fetchedAt = validTimestamp(capture.fetched_at);
  return {
    source: 'lastfm',
    ...entityColumns(item.entity_type, item.entity_id),
    observed_on: fetchedAt.slice(0, 10),
    listeners,
    playcount,
    fetched_at: fetchedAt
  };
}

function tagRows(item: ExternalMusicWorkItem, capture: LastFmCapture) {
  const tags = arrayAt(objectAt(capture.data, 'toptags'), 'tag');
  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  for (const tag of tags) {
    const rawTag = stringAt(tag, 'name');
    const normalizedTag = rawTag ? normalizeLastFmTag(rawTag) : '';
    if (!rawTag || !normalizedTag || seen.has(rawTag)) continue;
    seen.add(rawTag);
    rows.push({
      source: 'lastfm',
      ...entityColumns(item.entity_type, item.entity_id),
      raw_tag: rawTag,
      normalized_tag: normalizedTag,
      weight: nonnegativeInteger(isObject(tag) ? tag.count : null),
      rank: rows.length + 1,
      fetched_at: validTimestamp(capture.fetched_at)
    });
  }
  return rows;
}

function similarityRows(item: ExternalMusicWorkItem, capture: LastFmCapture) {
  const similarTracks = arrayAt(objectAt(capture.data, 'similartracks'), 'track').slice(0, MAX_SIMILAR_TRACKS);
  const rows: Array<Record<string, unknown>> = [];
  for (const similar of similarTracks) {
    const artistName = stringAt(objectAt(similar, 'artist'), 'name');
    const trackName = stringAt(similar, 'name');
    const rawMatch = isObject(similar) ? similar.match : null;
    const matchScore = typeof rawMatch === 'number'
      ? rawMatch
      : typeof rawMatch === 'string' && rawMatch.trim()
        ? Number(rawMatch)
        : NaN;
    if (!artistName || !trackName || !Number.isFinite(matchScore) || matchScore < 0 || matchScore > 1) continue;
    rows.push({
      source: 'lastfm',
      track_id: item.entity_id,
      rank: rows.length + 1,
      related_artist_name: artistName,
      related_track_name: trackName,
      related_url: stringAt(similar, 'url'),
      match_score: matchScore,
      source_playcount: nonnegativeInteger(isObject(similar) ? similar.playcount : null),
      fetched_at: validTimestamp(capture.fetched_at)
    });
  }
  return rows;
}

async function persistMusicBrainz(
  supabase: SupabaseClient,
  item: ExternalMusicWorkItem,
  write: MusicBrainzWrite
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('musicbrainz_track_matches')
    .delete()
    .eq('track_id', item.entity_id);
  throwIfError(deleteError, 'Deleting previous MusicBrainz matches failed');

  const rows = write.candidates
    .filter((candidate) => UUID_PATTERN.test(candidate.mbid))
    .map((candidate) => ({
      track_id: item.entity_id,
      recording_mbid: candidate.mbid,
      recording_title: candidate.title,
      artist_mbids: candidate.artistMbids.filter((mbid) => UUID_PATTERN.test(mbid)),
      artist_names: candidate.artistNames,
      duration_ms: candidate.durationMs,
      duration_delta_ms: candidate.durationDeltaMs,
      score: candidate.score,
      confidence: candidate.confidence,
      ambiguous: candidate.ambiguous,
      is_selected: candidate.mbid === write.selected?.mbid,
      match_reasons: candidate.reasons,
      checked_at: validTimestamp(write.fetchedAt)
    }));
  if (rows.length > 0) {
    const { error } = await supabase.from('musicbrainz_track_matches').insert(rows);
    throwIfError(error, 'Inserting MusicBrainz matches failed');
  }
}

async function persistInfo(
  supabase: SupabaseClient,
  item: ExternalMusicWorkItem,
  capture: LastFmCapture
): Promise<void> {
  const payload = payloadFor(item.entity_type, capture);
  if (!payload) throw new Error(`${capture.method} returned no ${item.entity_type} payload`);
  const { error: metadataError } = await supabase
    .from('external_music_metadata')
    .upsert(metadataRow(item, capture, payload), { onConflict: 'source,entity_type,entity_id' });
  throwIfError(metadataError, `Upserting ${item.entity_type} metadata failed`);

  const stats = statsRow(item, capture, payload);
  if (stats) {
    const { error: statsError } = await supabase
      .from('external_music_stats')
      .upsert(stats, { onConflict: 'source,entity_type,entity_id,observed_on' });
    throwIfError(statsError, `Upserting ${item.entity_type} stats failed`);
  }
}

async function persistTags(
  supabase: SupabaseClient,
  item: ExternalMusicWorkItem,
  capture: LastFmCapture
): Promise<void> {
  const column = entityColumn(item.entity_type);
  const { error: deleteError } = await supabase
    .from('external_music_tags')
    .delete()
    .eq('source', 'lastfm')
    .eq(column, item.entity_id);
  throwIfError(deleteError, `Deleting ${item.entity_type} tags failed`);
  const rows = tagRows(item, capture);
  if (rows.length > 0) {
    const { error } = await supabase.from('external_music_tags').insert(rows);
    throwIfError(error, `Inserting ${item.entity_type} tags failed`);
  }
}

async function persistSimilarities(
  supabase: SupabaseClient,
  item: ExternalMusicWorkItem,
  capture: LastFmCapture
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('external_track_similarities')
    .delete()
    .eq('source', 'lastfm')
    .eq('track_id', item.entity_id);
  throwIfError(deleteError, 'Deleting track similarities failed');
  const rows = similarityRows(item, capture);
  if (rows.length > 0) {
    const { error } = await supabase.from('external_track_similarities').insert(rows);
    throwIfError(error, 'Inserting track similarities failed');
  }
}

export async function persistExternalMusicWrites(
  supabase: SupabaseClient,
  item: ExternalMusicWorkItem,
  writes: ProviderWrites
): Promise<{ genresProjected: number; rollupDatesQueued: number }> {
  if (writes.musicbrainz && item.entity_type === 'track') {
    await persistMusicBrainz(supabase, item, writes.musicbrainz);
  }

  const info = writes.lastfm[captureKey(item.entity_type, 'info')];
  if (info) await persistInfo(supabase, item, info);

  const tags = writes.lastfm[captureKey(item.entity_type, 'tags')];
  if (tags) await persistTags(supabase, item, tags);

  const similar = writes.lastfm[captureKey(item.entity_type, 'similar')];
  if (similar && item.entity_type === 'track') await persistSimilarities(supabase, item, similar);

  const primaryArtist = item.context_artists.find((artist) => artist.artist_order === 0) ?? item.context_artists[0];
  const genreArtistIds = tags
    ? item.entity_type === 'artist'
      ? [item.entity_id]
      : primaryArtist
        ? [primaryArtist.id]
        : []
    : [];
  if (genreArtistIds.length === 0) return { genresProjected: 0, rollupDatesQueued: 0 };

  const { data: genresProjected, error: genreError } = await supabase.rpc('refresh_lastfm_artist_genres', {
    p_artist_ids: genreArtistIds
  });
  throwIfError(genreError, 'Refreshing Last.fm artist genres failed');
  const { data: rollupDatesQueued, error: queueError } = await supabase.rpc('queue_rollup_refresh_for_artists', {
    p_artist_ids: genreArtistIds
  });
  throwIfError(queueError, 'Queueing affected rollup dates failed');
  return {
    genresProjected: Number(genresProjected ?? 0),
    rollupDatesQueued: Number(rollupDatesQueued ?? 0)
  };
}
