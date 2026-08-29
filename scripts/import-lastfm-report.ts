import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLastFmImportBatch, type LastFmImportBatch } from './lib/lastfm-import.js';
import { createServiceClient, throwIfSupabaseError, type AdminClient } from './lib/supabase-admin.js';

const WRITE_CHUNK_SIZE = 500;

function stringFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || undefined;
}

function chunks<T>(values: T[], size = WRITE_CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function deleteEntityRows(
  supabase: AdminClient,
  table: 'external_music_tags',
  column: 'track_id' | 'artist_id' | 'album_id',
  ids: number[]
): Promise<void> {
  for (const idChunk of chunks(ids)) {
    if (idChunk.length === 0) continue;
    const { error } = await supabase.from(table).delete().eq('source', 'lastfm').in(column, idChunk);
    throwIfSupabaseError(error, `Deleting previous Last.fm ${column} tags failed`);
  }
}

async function insertChunks(
  supabase: AdminClient,
  table: string,
  rows: Array<Record<string, unknown>>
): Promise<void> {
  for (const rowChunk of chunks(rows)) {
    const { error } = await supabase.from(table).insert(rowChunk);
    throwIfSupabaseError(error, `Inserting ${table} failed`);
  }
}

async function upsertChunks(
  supabase: AdminClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  onConflict: string
): Promise<void> {
  for (const rowChunk of chunks(rows)) {
    const { error } = await supabase.from(table).upsert(rowChunk, { onConflict });
    throwIfSupabaseError(error, `Upserting ${table} failed`);
  }
}

export async function importLastFmBatch(supabase: AdminClient, batch: LastFmImportBatch): Promise<{
  genresProjected: number;
  rollupDatesQueued: number;
}> {
  for (const trackIds of chunks(batch.musicbrainzTrackIds)) {
    if (trackIds.length === 0) continue;
    const { error } = await supabase.from('musicbrainz_track_matches').delete().in('track_id', trackIds);
    throwIfSupabaseError(error, 'Deleting previous MusicBrainz matches failed');
  }
  await insertChunks(supabase, 'musicbrainz_track_matches', batch.musicbrainzMatches);

  await upsertChunks(
    supabase,
    'external_music_metadata',
    batch.metadata,
    'source,entity_type,entity_id'
  );
  await upsertChunks(
    supabase,
    'external_music_stats',
    batch.stats,
    'source,entity_type,entity_id,observed_on'
  );

  await deleteEntityRows(supabase, 'external_music_tags', 'track_id', batch.tagTrackIds);
  await deleteEntityRows(supabase, 'external_music_tags', 'artist_id', batch.tagArtistIds);
  await deleteEntityRows(supabase, 'external_music_tags', 'album_id', batch.tagAlbumIds);
  await insertChunks(supabase, 'external_music_tags', batch.tags);

  for (const trackIds of chunks(batch.similarityTrackIds)) {
    if (trackIds.length === 0) continue;
    const { error } = await supabase
      .from('external_track_similarities')
      .delete()
      .eq('source', 'lastfm')
      .in('track_id', trackIds);
    throwIfSupabaseError(error, 'Deleting previous Last.fm similarities failed');
  }
  await insertChunks(supabase, 'external_track_similarities', batch.similarities);

  const { data: genreRefresh, error: genreError } = await supabase.rpc('refresh_lastfm_artist_genres_and_queue', {
    p_artist_ids: batch.genreArtistIds
  });
  throwIfSupabaseError(genreError, 'Refreshing Last.fm artist genres and queueing affected rollups failed');
  const counts = (genreRefresh ?? {}) as {
    genres_projected?: number | string;
    rollup_dates_queued?: number | string;
  };

  return {
    genresProjected: Number(counts.genres_projected ?? 0),
    rollupDatesQueued: Number(counts.rollup_dates_queued ?? 0)
  };
}

function summary(batch: LastFmImportBatch): Record<string, unknown> {
  return {
    generated_at: batch.generatedAt,
    tracks: batch.trackIds.length,
    artists: batch.artistIds.length,
    albums: batch.albumIds.length,
    musicbrainz_candidates: batch.musicbrainzMatches.length,
    musicbrainz_selected: batch.musicbrainzMatches.filter((row) => row.is_selected).length,
    metadata_rows: batch.metadata.length,
    stat_snapshots: batch.stats.length,
    tag_evidence_rows: batch.tags.length,
    similar_track_rows: batch.similarities.length,
    genre_artists_refreshed: batch.genreArtistIds.length,
    warnings: batch.warnings
  };
}

export async function main(): Promise<void> {
  const input = stringFlag('input');
  if (!input) {
    throw new Error('Usage: pnpm import:lastfm-report --input=analysis/lastfm-spike/<report>.json [--dry-run]');
  }

  const path = resolve(input);
  const report = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const batch = buildLastFmImportBatch(report);
  const result = summary(batch);

  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ ...result, dry_run: true }, null, 2));
    return;
  }

  const writeResult = await importLastFmBatch(createServiceClient(), batch);
  console.log(JSON.stringify({ ...result, ...writeResult, dry_run: false }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
