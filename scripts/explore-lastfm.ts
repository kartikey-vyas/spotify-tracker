import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { optionalEnv } from './lib/env.js';
import { captureLastFm, topTagNames, type LastFmCapture } from './lib/lastfm.js';
import {
  lookupMusicBrainzByIsrc,
  scoreMusicBrainzRecordings,
  type MusicBrainzIsrcResponse,
  type ScoredMusicBrainzRecording
} from './lib/musicbrainz.js';
import { createServiceClient, throwIfSupabaseError, type AdminClient } from './lib/supabase-admin.js';

const DEFAULT_LIMIT = 25;
const ROLLUP_PAGE_SIZE = 1_000;
const METADATA_CHUNK_SIZE = 200;
const DEFAULT_MUSICBRAINZ_DELAY_MS = 1_100;
const DEFAULT_LASTFM_DELAY_MS = 300;
const DEFAULT_USER_AGENT = 'musik/0.1.0 (https://github.com/kartikey-vyas/spotify-tracker)';

type RollupRow = { entity_id: string; plays: number };
type TrackRow = {
  id: number;
  spotify_track_id: string | null;
  name: string;
  duration_ms: number | null;
  isrc: string;
  album_id: number | null;
};
type AlbumRow = { id: number; name: string };
type TrackArtistRow = { track_id: number; artist_id: number; artist_order: number };
type ArtistRow = { id: number; spotify_artist_id: string | null; name: string };

type SourceArtist = ArtistRow & { artist_order: number };
type SourceTrack = TrackRow & {
  plays: number;
  album: AlbumRow | null;
  artists: SourceArtist[];
};

type MusicBrainzCapture = {
  fetched_at: string;
  ok: boolean;
  data: MusicBrainzIsrcResponse | null;
  error: string | null;
  candidates: ScoredMusicBrainzRecording[];
  selected: ScoredMusicBrainzRecording | null;
};

type LastFmEntityCapture = {
  identity: Record<string, string | null>;
  calls: LastFmCapture[];
};

type SpikeReport = {
  generated_at: string;
  config: {
    limit: number;
    musicbrainz_only: boolean;
    musicbrainz_delay_ms: number;
    lastfm_delay_ms: number;
  };
  summary: {
    selected_tracks: number;
    musicbrainz_matches: number;
    high_confidence_matches: number;
    ambiguous_matches: number;
    lastfm_calls: number;
    lastfm_successes: number;
  };
  tracks: Array<{
    source: SourceTrack;
    musicbrainz: MusicBrainzCapture;
    lastfm: { by_mbid: LastFmCapture[]; by_name: LastFmCapture[] } | null;
  }>;
  artists: LastFmEntityCapture[];
  albums: LastFmEntityCapture[];
  tags: LastFmEntityCapture[];
};

function numericFlag(name: string, fallback: number): number {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const parsed = Number(arg.slice(name.length + 3));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function stringFlag(name: string): string | undefined {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3) || undefined;
}

function outputPath(): string {
  const explicit = stringFlag('output');
  if (explicit) return resolve(explicit);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(`analysis/lastfm-spike/lastfm-spike-${stamp}.json`);
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function loadRankedTrackIds(supabase: AdminClient): Promise<Array<{ id: number; plays: number }>> {
  const playsByTrack = new Map<number, number>();
  for (let from = 0; ; from += ROLLUP_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('rollup_daily_entity_stats')
      .select('entity_id,plays')
      .eq('entity_type', 'track')
      .is('archived_at', null)
      .order('user_id', { ascending: true })
      .order('local_date', { ascending: true })
      .order('entity_id', { ascending: true })
      .range(from, from + ROLLUP_PAGE_SIZE - 1)
      .returns<RollupRow[]>();
    throwIfSupabaseError(error, 'Loading track rollups failed');
    for (const row of data ?? []) {
      const id = Number(row.entity_id);
      if (!Number.isSafeInteger(id)) continue;
      playsByTrack.set(id, (playsByTrack.get(id) ?? 0) + (row.plays ?? 0));
    }
    if (!data || data.length < ROLLUP_PAGE_SIZE) break;
  }
  return [...playsByTrack]
    .map(([id, plays]) => ({ id, plays }))
    .sort((left, right) => right.plays - left.plays || left.id - right.id);
}

async function loadRepresentativeTracks(supabase: AdminClient, limit: number): Promise<SourceTrack[]> {
  const ranked = await loadRankedTrackIds(supabase);
  const candidates = ranked.slice(0, Math.min(Math.max(limit * 4, 100), 1_000));
  const candidateIds = candidates.map(({ id }) => id);
  const tracks: TrackRow[] = [];
  const trackArtists: TrackArtistRow[] = [];

  for (const ids of chunks(candidateIds, METADATA_CHUNK_SIZE)) {
    const [trackResult, artistResult] = await Promise.all([
      supabase
        .from('tracks')
        .select('id,spotify_track_id,name,duration_ms,isrc,album_id')
        .in('id', ids)
        .not('isrc', 'is', null)
        .returns<TrackRow[]>(),
      supabase
        .from('track_artists')
        .select('track_id,artist_id,artist_order')
        .in('track_id', ids)
        .returns<TrackArtistRow[]>()
    ]);
    throwIfSupabaseError(trackResult.error, 'Loading representative tracks failed');
    throwIfSupabaseError(artistResult.error, 'Loading representative track artists failed');
    tracks.push(...(trackResult.data ?? []));
    trackArtists.push(...(artistResult.data ?? []));
  }

  const albumIds = [...new Set(tracks.map((track) => track.album_id).filter((id): id is number => id !== null))];
  const artistIds = [...new Set(trackArtists.map((row) => row.artist_id))];
  const albums: AlbumRow[] = [];
  const artists: ArtistRow[] = [];
  for (const ids of chunks(albumIds, METADATA_CHUNK_SIZE)) {
    const { data, error } = await supabase.from('albums').select('id,name').in('id', ids).returns<AlbumRow[]>();
    throwIfSupabaseError(error, 'Loading representative albums failed');
    albums.push(...(data ?? []));
  }
  for (const ids of chunks(artistIds, METADATA_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('artists')
      .select('id,spotify_artist_id,name')
      .in('id', ids)
      .returns<ArtistRow[]>();
    throwIfSupabaseError(error, 'Loading representative artists failed');
    artists.push(...(data ?? []));
  }

  const playMap = new Map(candidates.map(({ id, plays }) => [id, plays]));
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  const albumMap = new Map(albums.map((album) => [album.id, album]));
  const artistMap = new Map(artists.map((artist) => [artist.id, artist]));
  const creditsByTrack = new Map<number, SourceArtist[]>();
  for (const relation of trackArtists) {
    const artist = artistMap.get(relation.artist_id);
    if (!artist) continue;
    const credits = creditsByTrack.get(relation.track_id) ?? [];
    credits.push({ ...artist, artist_order: relation.artist_order });
    creditsByTrack.set(relation.track_id, credits);
  }

  return candidates
    .map(({ id }) => trackMap.get(id))
    .filter((track): track is TrackRow => Boolean(track))
    .map((track) => ({
      ...track,
      plays: playMap.get(track.id) ?? 0,
      album: track.album_id === null ? null : (albumMap.get(track.album_id) ?? null),
      artists: (creditsByTrack.get(track.id) ?? []).sort((left, right) => left.artist_order - right.artist_order)
    }))
    .slice(0, limit);
}

function emptyReport(limit: number, musicbrainzOnly: boolean, musicbrainzDelayMs: number, lastfmDelayMs: number): SpikeReport {
  return {
    generated_at: new Date().toISOString(),
    config: {
      limit,
      musicbrainz_only: musicbrainzOnly,
      musicbrainz_delay_ms: musicbrainzDelayMs,
      lastfm_delay_ms: lastfmDelayMs
    },
    summary: {
      selected_tracks: 0,
      musicbrainz_matches: 0,
      high_confidence_matches: 0,
      ambiguous_matches: 0,
      lastfm_calls: 0,
      lastfm_successes: 0
    },
    tracks: [],
    artists: [],
    albums: [],
    tags: []
  };
}

function updateSummary(report: SpikeReport): void {
  const matches = report.tracks.map((track) => track.musicbrainz.selected).filter(Boolean);
  const calls = [
    ...report.tracks.flatMap((track) => [...(track.lastfm?.by_mbid ?? []), ...(track.lastfm?.by_name ?? [])]),
    ...report.artists.flatMap((artist) => artist.calls),
    ...report.albums.flatMap((album) => album.calls),
    ...report.tags.flatMap((tag) => tag.calls)
  ];
  report.summary = {
    selected_tracks: report.tracks.length,
    musicbrainz_matches: matches.length,
    high_confidence_matches: matches.filter((match) => match?.confidence === 'high').length,
    ambiguous_matches: report.tracks.filter((track) => track.musicbrainz.candidates[0]?.ambiguous).length,
    lastfm_calls: calls.length,
    lastfm_successes: calls.filter((call) => call.ok).length
  };
}

async function persistReport(path: string, report: SpikeReport): Promise<void> {
  updateSummary(report);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

function musicBrainzArtistRefs(report: SpikeReport): Array<{ mbid: string; name: string }> {
  const refs = new Map<string, { mbid: string; name: string }>();
  for (const track of report.tracks) {
    const selected = track.musicbrainz.selected;
    if (!selected) continue;
    selected.artistMbids.forEach((mbid, index) => {
      refs.set(mbid, { mbid, name: selected.artistNames[index] ?? '' });
    });
  }
  return [...refs.values()];
}

function sourceAlbums(report: SpikeReport): Array<{ artist: string; album: string }> {
  const refs = new Map<string, { artist: string; album: string }>();
  for (const track of report.tracks) {
    const album = track.source.album?.name;
    const artist = track.source.artists[0]?.name;
    if (!album || !artist) continue;
    refs.set(`${artist.toLocaleLowerCase('en')}\u0000${album.toLocaleLowerCase('en')}`, { artist, album });
  }
  return [...refs.values()];
}

export async function main(): Promise<void> {
  const limit = Math.max(1, Math.floor(numericFlag('limit', DEFAULT_LIMIT)));
  const musicbrainzOnly = process.argv.includes('--musicbrainz-only');
  const musicbrainzDelayMs = numericFlag('musicbrainz-delay-ms', DEFAULT_MUSICBRAINZ_DELAY_MS);
  const lastfmDelayMs = numericFlag('lastfm-delay-ms', DEFAULT_LASTFM_DELAY_MS);
  const lastfmApiKey = optionalEnv('LASTFM_API_KEY');
  if (!musicbrainzOnly && !lastfmApiKey) {
    throw new Error('Missing LASTFM_API_KEY. Add it to .env.local or run with --musicbrainz-only.');
  }

  const path = outputPath();
  const report = emptyReport(limit, musicbrainzOnly, musicbrainzDelayMs, lastfmDelayMs);
  const tracks = await loadRepresentativeTracks(createServiceClient(), limit);
  console.log(`Selected ${tracks.length} top-played tracks with ISRCs.`);

  for (const [index, source] of tracks.entries()) {
    if (index > 0) await delay(musicbrainzDelayMs);
    const fetchedAt = new Date().toISOString();
    let musicbrainz: MusicBrainzCapture;
    try {
      const data = await lookupMusicBrainzByIsrc(source.isrc, {
        userAgent: optionalEnv('MUSICBRAINZ_USER_AGENT') ?? DEFAULT_USER_AGENT
      });
      const candidates = scoreMusicBrainzRecordings(
        {
          name: source.name,
          durationMs: source.duration_ms,
          artistNames: source.artists.map((artist) => artist.name)
        },
        data.recordings ?? []
      );
      const best = candidates[0] ?? null;
      musicbrainz = {
        fetched_at: fetchedAt,
        ok: true,
        data,
        error: null,
        candidates,
        // Preserve every candidate in the report, but only promote a match
        // when title/artist evidence is strong and the winner is unambiguous.
        selected: best && best.confidence !== 'low' && !best.ambiguous ? best : null
      };
    } catch (error) {
      musicbrainz = {
        fetched_at: fetchedAt,
        ok: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
        candidates: [],
        selected: null
      };
    }
    report.tracks.push({ source, musicbrainz, lastfm: null });
    await persistReport(path, report);
    const best = musicbrainz.candidates[0];
    console.log(
      `  MusicBrainz ${index + 1}/${tracks.length}: ${source.artists[0]?.name ?? 'Unknown'} — ${source.name} (${musicbrainz.selected?.confidence ?? (best?.ambiguous ? 'ambiguous' : 'no match')})`
    );
  }

  if (musicbrainzOnly) {
    console.log(`Wrote MusicBrainz spike to ${path}`);
    return;
  }

  const lastfm = async (method: string, params: Record<string, string | number>): Promise<LastFmCapture> => {
    await delay(lastfmDelayMs);
    return captureLastFm(lastfmApiKey!, method, params);
  };

  for (const [index, track] of report.tracks.entries()) {
    const primaryArtist = track.source.artists[0]?.name;
    const selected = track.musicbrainz.selected;
    const byMbid: LastFmCapture[] = [];
    const byName: LastFmCapture[] = [];
    if (selected) {
      for (const method of ['track.getInfo', 'track.getTopTags', 'track.getSimilar']) {
        byMbid.push(await lastfm(method, { mbid: selected.mbid }));
      }
    }
    if (primaryArtist) {
      for (const method of ['track.getInfo', 'track.getTopTags', 'track.getSimilar']) {
        byName.push(await lastfm(method, { artist: primaryArtist, track: track.source.name, autocorrect: 1 }));
      }
    }
    track.lastfm = { by_mbid: byMbid, by_name: byName };
    await persistReport(path, report);
    console.log(`  Last.fm tracks ${index + 1}/${report.tracks.length}`);
  }

  for (const ref of musicBrainzArtistRefs(report)) {
    const calls: LastFmCapture[] = [];
    for (const method of [
      'artist.getInfo',
      'artist.getTopTags',
      'artist.getSimilar',
      'artist.getTopTracks',
      'artist.getTopAlbums'
    ]) {
      calls.push(await lastfm(method, { mbid: ref.mbid, autocorrect: 1 }));
    }
    report.artists.push({ identity: ref, calls });
    await persistReport(path, report);
  }

  for (const ref of sourceAlbums(report)) {
    const calls = [
      await lastfm('album.getInfo', { artist: ref.artist, album: ref.album, autocorrect: 1 }),
      await lastfm('album.getTopTags', { artist: ref.artist, album: ref.album, autocorrect: 1 })
    ];
    report.albums.push({ identity: { artist: ref.artist, album: ref.album }, calls });
    await persistReport(path, report);
  }

  const topTags = new Map<string, { name: string; count: number }>();
  const tagCaptures = [
    ...report.tracks.flatMap((track) => [...(track.lastfm?.by_mbid ?? []), ...(track.lastfm?.by_name ?? [])]),
    ...report.artists.flatMap((artist) => artist.calls),
    ...report.albums.flatMap((album) => album.calls)
  ].filter((capture) => capture.method.endsWith('getTopTags'));
  for (const name of topTagNames(tagCaptures)) {
    const key = name.toLocaleLowerCase('en');
    const current = topTags.get(key);
    topTags.set(key, { name: current?.name ?? name, count: (current?.count ?? 0) + 1 });
  }
  for (const tag of [...topTags.values()].sort((left, right) => right.count - left.count).slice(0, 20)) {
    const calls = [await lastfm('tag.getInfo', { tag: tag.name }), await lastfm('tag.getSimilar', { tag: tag.name })];
    report.tags.push({ identity: { tag: tag.name, occurrences: String(tag.count) }, calls });
    await persistReport(path, report);
  }

  console.log(`Wrote Last.fm spike to ${path}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
