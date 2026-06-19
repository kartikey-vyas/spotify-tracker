import { createServiceClient, refreshPublicStats, throwIfSupabaseError } from './lib/supabase-admin.js';
import { uniqueSortedDates } from './lib/dates.js';
import { getArtists, getTracks, refreshSpotifyAccessToken } from './lib/spotify.js';
import { upsertArtistFromSpotify, upsertTrackFromSpotify } from './lib/spotify-dimensions.js';

type TrackRow = {
  id: number;
  spotify_track_id: string;
};

type ArtistRow = {
  id: number;
  spotify_artist_id: string;
};

const MAX_TRACKS = 50;
const MAX_ARTISTS = 50;
const ARTIST_REFRESH_DAYS = 90;

async function datesForColumn(
  column: 'track_id' | 'primary_artist_id',
  ids: number[]
): Promise<string[]> {
  if (ids.length === 0) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase.from('listening_events').select('local_date').in(column, ids);
  throwIfSupabaseError(error, `Finding affected dates for ${column} failed`);
  return (data ?? []).map((row: { local_date: string }) => row.local_date);
}

async function markMetadataError(message: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('sync_state')
    .update({
      metadata_last_error_at: new Date().toISOString(),
      metadata_last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString()
    })
    .eq('id', 1);
  throwIfSupabaseError(error, 'Updating metadata error failed');
}

async function main(): Promise<void> {
  const supabase = createServiceClient();

  try {
    const accessToken = await refreshSpotifyAccessToken();
    const { data: trackRows, error: trackError } = await supabase
      .from('tracks')
      .select('id,spotify_track_id')
      .not('spotify_track_id', 'is', null)
      .or('duration_ms.is.null,last_refreshed_at.is.null')
      .limit(MAX_TRACKS)
      .returns<TrackRow[]>();
    throwIfSupabaseError(trackError, 'Loading tracks needing metadata failed');

    const affectedDates = new Set<string>();
    const affectedTrackIds = [];

    if (trackRows && trackRows.length > 0) {
      const tracks = await getTracks(
        accessToken,
        trackRows.map((row) => row.spotify_track_id)
      );

      for (const track of tracks) {
        const dimensions = await upsertTrackFromSpotify(supabase, track);
        affectedTrackIds.push(dimensions.trackId);
        const { error } = await supabase
          .from('listening_events')
          .update({
            primary_artist_id: dimensions.primaryArtistId,
            album_id: dimensions.albumId
          })
          .eq('track_id', dimensions.trackId);
        throwIfSupabaseError(error, 'Backfilling event artist/album metadata failed');
      }
    }

    for (const localDate of await datesForColumn('track_id', affectedTrackIds)) {
      affectedDates.add(localDate);
    }

    const staleBefore = new Date(Date.now() - ARTIST_REFRESH_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: artistRows, error: artistError } = await supabase
      .from('artists')
      .select('id,spotify_artist_id')
      .not('spotify_artist_id', 'is', null)
      .or(`last_refreshed_at.is.null,last_refreshed_at.lt.${staleBefore}`)
      .limit(MAX_ARTISTS)
      .returns<ArtistRow[]>();
    throwIfSupabaseError(artistError, 'Loading artists needing metadata failed');

    const refreshedArtistIds = [];
    if (artistRows && artistRows.length > 0) {
      const artists = await getArtists(
        accessToken,
        artistRows.map((row) => row.spotify_artist_id)
      );

      for (const artist of artists) {
        refreshedArtistIds.push(await upsertArtistFromSpotify(supabase, artist));
      }
    }

    for (const localDate of await datesForColumn('primary_artist_id', refreshedArtistIds)) {
      affectedDates.add(localDate);
    }

    await refreshPublicStats(supabase, uniqueSortedDates(affectedDates));

    const { error: updateError } = await supabase
      .from('sync_state')
      .update({
        metadata_last_success_at: new Date().toISOString(),
        metadata_last_error_at: null,
        metadata_last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1);
    throwIfSupabaseError(updateError, 'Updating metadata success failed');

    console.log(
      JSON.stringify(
        {
          tracks_refreshed: trackRows?.length ?? 0,
          artists_refreshed: artistRows?.length ?? 0,
          affected_dates: uniqueSortedDates(affectedDates)
        },
        null,
        2
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markMetadataError(message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
