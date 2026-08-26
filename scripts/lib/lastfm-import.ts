import { normalizeMusicName, type ScoredMusicBrainzRecording } from './musicbrainz.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_SIMILAR_TRACKS = 20;

type JsonObject = Record<string, unknown>;

type EntityColumns = {
  track_id: number | null;
  artist_id: number | null;
  album_id: number | null;
};

export type MusicBrainzMatchRow = {
  track_id: number;
  recording_mbid: string;
  recording_title: string;
  artist_mbids: string[];
  artist_names: string[];
  duration_ms: number | null;
  duration_delta_ms: number | null;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  ambiguous: boolean;
  is_selected: boolean;
  match_reasons: string[];
  checked_at: string;
};

export type ExternalMetadataRow = EntityColumns & {
  source: 'lastfm';
  canonical_name: string;
  canonical_artist_name: string | null;
  source_url: string | null;
  summary_html: string | null;
  summary_published_at: string | null;
  match_method: 'mbid' | 'name' | 'name_fallback';
  fetched_at: string;
};

export type ExternalStatsRow = EntityColumns & {
  source: 'lastfm';
  observed_on: string;
  listeners: number | null;
  playcount: number | null;
  fetched_at: string;
};

export type ExternalTagRow = EntityColumns & {
  source: 'lastfm';
  raw_tag: string;
  normalized_tag: string;
  weight: number | null;
  rank: number;
  fetched_at: string;
};

export type SimilarityRow = {
  source: 'lastfm';
  track_id: number;
  rank: number;
  related_artist_name: string;
  related_track_name: string;
  related_url: string | null;
  match_score: number;
  source_playcount: number | null;
  fetched_at: string;
};

export type LastFmImportBatch = {
  generatedAt: string;
  trackIds: number[];
  artistIds: number[];
  albumIds: number[];
  musicbrainzTrackIds: number[];
  tagTrackIds: number[];
  tagArtistIds: number[];
  tagAlbumIds: number[];
  similarityTrackIds: number[];
  genreArtistIds: number[];
  musicbrainzMatches: MusicBrainzMatchRow[];
  metadata: ExternalMetadataRow[];
  stats: ExternalStatsRow[];
  tags: ExternalTagRow[];
  similarities: SimilarityRow[];
  warnings: string[];
};

type Capture = {
  method: string;
  fetched_at: string;
  ok: boolean;
  data: unknown;
};

type SourceArtist = { id: number; name: string; artist_order: number };
type SourceAlbum = { id: number; name: string };
type SourceTrack = {
  id: number;
  name: string;
  album: SourceAlbum | null;
  artists: SourceArtist[];
};

type ReportTrack = {
  source: SourceTrack;
  musicbrainz: {
    fetched_at: string;
    ok: boolean;
    candidates: ScoredMusicBrainzRecording[];
    selected: ScoredMusicBrainzRecording | null;
  };
  lastfm: { by_name: Capture[] } | null;
};

type ReportEntity = {
  identity: Record<string, string | null>;
  calls: Capture[];
};

type SpikeReport = {
  generated_at: string;
  tracks: ReportTrack[];
  artists: ReportEntity[];
  albums: ReportEntity[];
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, key: string): JsonObject | null {
  if (!isObject(value)) return null;
  const child = value[key];
  return isObject(child) ? child : null;
}

function arrayAt(value: unknown, key: string): unknown[] {
  if (!isObject(value)) return [];
  const child = value[key];
  return Array.isArray(child) ? child : [];
}

function stringAt(value: unknown, key: string): string | null {
  if (!isObject(value)) return null;
  const child = value[key];
  return typeof child === 'string' && child.trim() ? child.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function nonnegativeInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 && Number.isSafeInteger(parsed) ? parsed : null;
}

function validTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
}

function captureFor(captures: Capture[] | undefined, method: string): Capture | null {
  return captures?.find((capture) => capture.method === method && capture.ok && isObject(capture.data)) ?? null;
}

function entityColumns(kind: 'track' | 'artist' | 'album', id: number): EntityColumns {
  return {
    track_id: kind === 'track' ? id : null,
    artist_id: kind === 'artist' ? id : null,
    album_id: kind === 'album' ? id : null
  };
}

function entityKey(row: EntityColumns): string {
  if (row.track_id !== null) return `track:${row.track_id}`;
  if (row.artist_id !== null) return `artist:${row.artist_id}`;
  return `album:${row.album_id}`;
}

export function normalizeLastFmTag(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/&/g, ' and ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function metadataRow(
  kind: 'track' | 'artist' | 'album',
  id: number,
  payload: JsonObject,
  fetchedAt: string,
  matchMethod: ExternalMetadataRow['match_method'],
  fallbackName: string
): ExternalMetadataRow {
  const description = objectAt(payload, kind === 'artist' ? 'bio' : 'wiki');
  const embeddedArtist = objectAt(payload, 'artist');
  return {
    source: 'lastfm',
    ...entityColumns(kind, id),
    canonical_name: stringAt(payload, 'name') ?? stringAt(payload, 'title') ?? fallbackName,
    canonical_artist_name:
      typeof payload.artist === 'string'
        ? payload.artist
        : stringAt(embeddedArtist, 'name'),
    source_url: stringAt(payload, 'url'),
    summary_html: stringAt(description, 'summary'),
    summary_published_at: stringAt(description, 'published'),
    match_method: matchMethod,
    fetched_at: fetchedAt
  };
}

function statsRow(
  kind: 'track' | 'artist' | 'album',
  id: number,
  payload: JsonObject,
  fetchedAt: string
): ExternalStatsRow | null {
  const nestedStats = objectAt(payload, 'stats');
  const listeners = nonnegativeInteger(payload.listeners ?? nestedStats?.listeners);
  const playcount = nonnegativeInteger(payload.playcount ?? nestedStats?.playcount);
  if (listeners === null && playcount === null) return null;
  return {
    source: 'lastfm',
    ...entityColumns(kind, id),
    observed_on: fetchedAt.slice(0, 10),
    listeners,
    playcount,
    fetched_at: fetchedAt
  };
}

function tagRows(
  kind: 'track' | 'artist' | 'album',
  id: number,
  capture: Capture | null,
  fallbackTimestamp: string
): ExternalTagRow[] {
  const topTags = objectAt(capture?.data, 'toptags');
  const tags = arrayAt(topTags, 'tag');
  const fetchedAt = validTimestamp(capture?.fetched_at, fallbackTimestamp);
  const seen = new Set<string>();
  const rows: ExternalTagRow[] = [];
  for (const tag of tags) {
    const rawTag = stringAt(tag, 'name');
    const normalizedTag = rawTag ? normalizeLastFmTag(rawTag) : '';
    if (!rawTag || !normalizedTag || seen.has(rawTag)) continue;
    seen.add(rawTag);
    rows.push({
      source: 'lastfm',
      ...entityColumns(kind, id),
      raw_tag: rawTag,
      normalized_tag: normalizedTag,
      weight: nonnegativeInteger(isObject(tag) ? tag.count : null),
      rank: rows.length + 1,
      fetched_at: fetchedAt
    });
  }
  return rows;
}

function addMetadata(map: Map<string, ExternalMetadataRow>, row: ExternalMetadataRow): void {
  map.set(entityKey(row), row);
}

function addStats(map: Map<string, ExternalStatsRow>, row: ExternalStatsRow | null): void {
  if (!row) return;
  map.set(`${entityKey(row)}:${row.observed_on}`, row);
}

function parseSpikeReport(input: unknown): SpikeReport {
  if (!isObject(input) || !Array.isArray(input.tracks) || !Array.isArray(input.artists) || !Array.isArray(input.albums)) {
    throw new Error('Not a MusicBrainz + Last.fm spike report');
  }
  const generatedAt = validTimestamp(input.generated_at, '');
  if (!generatedAt) throw new Error('Spike report has no valid generated_at timestamp');
  return input as unknown as SpikeReport;
}

function uniqueSourceArtistByName(tracks: ReportTrack[]): Map<string, SourceArtist> {
  const candidates = new Map<string, Map<number, SourceArtist>>();
  for (const track of tracks) {
    for (const artist of track.source.artists ?? []) {
      const key = normalizeMusicName(artist.name);
      const matches = candidates.get(key) ?? new Map<number, SourceArtist>();
      matches.set(artist.id, artist);
      candidates.set(key, matches);
    }
  }
  const unique = new Map<string, SourceArtist>();
  for (const [key, matches] of candidates) {
    if (matches.size === 1) unique.set(key, [...matches.values()][0]!);
  }
  return unique;
}

function musicBrainzArtistMap(tracks: ReportTrack[], sourceByName: Map<string, SourceArtist>): Map<string, SourceArtist> {
  const result = new Map<string, SourceArtist>();
  for (const track of tracks) {
    const selected = track.musicbrainz.selected;
    if (!selected) continue;
    selected.artistMbids.forEach((mbid, index) => {
      const name = selected.artistNames[index];
      const source = name ? sourceByName.get(normalizeMusicName(name)) : null;
      if (source && UUID_PATTERN.test(mbid)) result.set(mbid.toLocaleLowerCase('en'), source);
    });
  }
  return result;
}

function albumMap(tracks: ReportTrack[]): Map<string, SourceAlbum> {
  const result = new Map<string, SourceAlbum>();
  const ambiguous = new Set<string>();
  for (const track of tracks) {
    const album = track.source.album;
    const primaryArtist = track.source.artists.find((artist) => artist.artist_order === 0) ?? track.source.artists[0];
    if (!album || !primaryArtist) continue;
    const key = `${normalizeMusicName(primaryArtist.name)}\u0000${normalizeMusicName(album.name)}`;
    const existing = result.get(key);
    if (existing && existing.id !== album.id) ambiguous.add(key);
    else result.set(key, album);
  }
  for (const key of ambiguous) result.delete(key);
  return result;
}

export function buildLastFmImportBatch(input: unknown): LastFmImportBatch {
  const report = parseSpikeReport(input);
  const metadata = new Map<string, ExternalMetadataRow>();
  const stats = new Map<string, ExternalStatsRow>();
  const tags: ExternalTagRow[] = [];
  const similarities: SimilarityRow[] = [];
  const musicbrainzMatches: MusicBrainzMatchRow[] = [];
  const warnings: string[] = [];
  const trackIds = new Set<number>();
  const artistIds = new Set<number>();
  const albumIds = new Set<number>();
  const musicbrainzTrackIds = new Set<number>();
  const tagTrackIds = new Set<number>();
  const tagArtistIds = new Set<number>();
  const tagAlbumIds = new Set<number>();
  const similarityTrackIds = new Set<number>();
  const genreArtistIds = new Set<number>();
  const sourceByName = uniqueSourceArtistByName(report.tracks);
  const sourceByArtistMbid = musicBrainzArtistMap(report.tracks, sourceByName);
  const sourceAlbums = albumMap(report.tracks);

  for (const reportTrack of report.tracks) {
    const { source } = reportTrack;
    if (!Number.isSafeInteger(source.id)) continue;
    trackIds.add(source.id);
    for (const artist of source.artists ?? []) artistIds.add(artist.id);
    if (source.album) albumIds.add(source.album.id);

    const selectedMbid = reportTrack.musicbrainz.selected?.mbid;
    const checkedAt = validTimestamp(reportTrack.musicbrainz.fetched_at, report.generated_at);
    if (reportTrack.musicbrainz.ok) musicbrainzTrackIds.add(source.id);
    for (const candidate of reportTrack.musicbrainz.ok ? (reportTrack.musicbrainz.candidates ?? []) : []) {
      if (!UUID_PATTERN.test(candidate.mbid)) {
        warnings.push(`Skipped invalid recording MBID for track ${source.id}: ${candidate.mbid}`);
        continue;
      }
      musicbrainzMatches.push({
        track_id: source.id,
        recording_mbid: candidate.mbid,
        recording_title: candidate.title,
        artist_mbids: candidate.artistMbids.filter((mbid) => UUID_PATTERN.test(mbid)),
        artist_names: candidate.artistNames,
        duration_ms: candidate.durationMs,
        duration_delta_ms: candidate.durationDeltaMs,
        score: candidate.score,
        confidence: candidate.confidence,
        ambiguous: candidate.ambiguous,
        is_selected: candidate.mbid === selectedMbid,
        match_reasons: candidate.reasons,
        checked_at: checkedAt
      });
    }

    const infoCapture = captureFor(reportTrack.lastfm?.by_name, 'track.getInfo');
    const trackPayload = objectAt(infoCapture?.data, 'track');
    if (infoCapture && trackPayload) {
      const fetchedAt = validTimestamp(infoCapture.fetched_at, report.generated_at);
      addMetadata(metadata, metadataRow('track', source.id, trackPayload, fetchedAt, 'name', source.name));
      addStats(stats, statsRow('track', source.id, trackPayload, fetchedAt));
    }

    const trackTagCapture = captureFor(reportTrack.lastfm?.by_name, 'track.getTopTags');
    if (trackTagCapture) {
      tagTrackIds.add(source.id);
      const primaryArtist = source.artists.find((artist) => artist.artist_order === 0) ?? source.artists[0];
      if (primaryArtist) genreArtistIds.add(primaryArtist.id);
    }
    tags.push(...tagRows('track', source.id, trackTagCapture, report.generated_at));

    const similarCapture = captureFor(reportTrack.lastfm?.by_name, 'track.getSimilar');
    if (similarCapture) similarityTrackIds.add(source.id);
    const similarTracks = arrayAt(objectAt(similarCapture?.data, 'similartracks'), 'track').slice(0, MAX_SIMILAR_TRACKS);
    const similarFetchedAt = validTimestamp(similarCapture?.fetched_at, report.generated_at);
    for (const similar of similarTracks) {
      const artist = objectAt(similar, 'artist');
      const artistName = stringAt(artist, 'name');
      const trackName = stringAt(similar, 'name');
      const matchScore = finiteNumber(isObject(similar) ? similar.match : null);
      if (!artistName || !trackName || matchScore === null || matchScore < 0 || matchScore > 1) continue;
      similarities.push({
        source: 'lastfm',
        track_id: source.id,
        rank: similarities.filter((row) => row.track_id === source.id).length + 1,
        related_artist_name: artistName,
        related_track_name: trackName,
        related_url: stringAt(similar, 'url'),
        match_score: matchScore,
        source_playcount: nonnegativeInteger(isObject(similar) ? similar.playcount : null),
        fetched_at: similarFetchedAt
      });
    }
  }

  for (const reportArtist of report.artists) {
    const identityMbid = reportArtist.identity.mbid?.toLocaleLowerCase('en') ?? '';
    const identityName = reportArtist.identity.name ?? '';
    const sourceFromMbid = sourceByArtistMbid.get(identityMbid);
    const source = sourceFromMbid ?? sourceByName.get(normalizeMusicName(identityName));
    if (!source) {
      warnings.push(`Could not map Last.fm artist capture: ${identityName || identityMbid}`);
      continue;
    }
    artistIds.add(source.id);
    const infoCapture = captureFor(reportArtist.calls, 'artist.getInfo');
    const artistPayload = objectAt(infoCapture?.data, 'artist');
    if (infoCapture && artistPayload) {
      const fetchedAt = validTimestamp(infoCapture.fetched_at, report.generated_at);
      addMetadata(
        metadata,
        metadataRow('artist', source.id, artistPayload, fetchedAt, sourceFromMbid ? 'mbid' : 'name_fallback', source.name)
      );
      addStats(stats, statsRow('artist', source.id, artistPayload, fetchedAt));
    }
    const artistTagCapture = captureFor(reportArtist.calls, 'artist.getTopTags');
    if (artistTagCapture) {
      tagArtistIds.add(source.id);
      genreArtistIds.add(source.id);
    }
    tags.push(...tagRows('artist', source.id, artistTagCapture, report.generated_at));
  }

  for (const reportAlbum of report.albums) {
    const identityArtist = reportAlbum.identity.artist ?? '';
    const identityAlbum = reportAlbum.identity.album ?? '';
    const key = `${normalizeMusicName(identityArtist)}\u0000${normalizeMusicName(identityAlbum)}`;
    const source = sourceAlbums.get(key);
    if (!source) {
      warnings.push(`Could not map Last.fm album capture: ${identityArtist} — ${identityAlbum}`);
      continue;
    }
    albumIds.add(source.id);
    const infoCapture = captureFor(reportAlbum.calls, 'album.getInfo');
    const albumPayload = objectAt(infoCapture?.data, 'album');
    if (infoCapture && albumPayload) {
      const fetchedAt = validTimestamp(infoCapture.fetched_at, report.generated_at);
      addMetadata(metadata, metadataRow('album', source.id, albumPayload, fetchedAt, 'name', source.name));
      addStats(stats, statsRow('album', source.id, albumPayload, fetchedAt));
    }
    const albumTagCapture = captureFor(reportAlbum.calls, 'album.getTopTags');
    if (albumTagCapture) {
      tagAlbumIds.add(source.id);
      const primaryArtist = sourceByName.get(normalizeMusicName(identityArtist));
      if (primaryArtist) genreArtistIds.add(primaryArtist.id);
    }
    tags.push(...tagRows('album', source.id, albumTagCapture, report.generated_at));
  }

  // An endpoint can repeat the exact same tag. Preserve spelling variants as
  // separate evidence, but make exact duplicates deterministic for the DB key.
  const uniqueTags = new Map<string, ExternalTagRow>();
  for (const tag of tags) {
    const key = `${entityKey(tag)}\u0000${tag.raw_tag}`;
    const current = uniqueTags.get(key);
    if (!current || tag.rank < current.rank) uniqueTags.set(key, tag);
  }

  return {
    generatedAt: report.generated_at,
    trackIds: [...trackIds].sort((left, right) => left - right),
    artistIds: [...artistIds].sort((left, right) => left - right),
    albumIds: [...albumIds].sort((left, right) => left - right),
    musicbrainzTrackIds: [...musicbrainzTrackIds].sort((left, right) => left - right),
    tagTrackIds: [...tagTrackIds].sort((left, right) => left - right),
    tagArtistIds: [...tagArtistIds].sort((left, right) => left - right),
    tagAlbumIds: [...tagAlbumIds].sort((left, right) => left - right),
    similarityTrackIds: [...similarityTrackIds].sort((left, right) => left - right),
    genreArtistIds: [...genreArtistIds].sort((left, right) => left - right),
    musicbrainzMatches,
    metadata: [...metadata.values()],
    stats: [...stats.values()],
    tags: [...uniqueTags.values()],
    similarities,
    warnings
  };
}
