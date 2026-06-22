import { createServiceClient, throwIfSupabaseError } from './lib/supabase-admin.js';
import { localDateFor, uniqueSortedDates, unixMs } from './lib/dates.js';
import { sha256 } from './lib/hash.js';
import { getRecentlyPlayed, refreshSpotifyAccessToken } from './lib/spotify.js';
import { upsertTrackFromSpotify } from './lib/spotify-dimensions.js';

type SyncState = {
  recently_played_cursor_ms: number | null;
  recently_played_last_success_at: string | null;
  recently_played_gap_risk: boolean;
};

const SOURCE_RECENTLY_PLAYED = 2;
const QUALITY_API_UNKNOWN_DURATION = 2;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function apiSourceEventKey(playedAt: string, trackUri: string | null | undefined): string {
  return sha256(['recently_played_api', playedAt, trackUri]);
}

async function markSyncError(message: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('sync_state')
    .update({
      recently_played_last_error_at: new Date().toISOString(),
      recently_played_last_error: message.slice(0, 1000),
      recently_played_gap_risk: true,
      updated_at: new Date().toISOString()
    })
    .eq('id', 1);
  throwIfSupabaseError(error, 'Updating sync_state error failed');
}

async function main(): Promise<void> {
  const supabase = createServiceClient();

  try {
    const { data: state, error: stateError } = await supabase
      .from('sync_state')
      .select('recently_played_cursor_ms,recently_played_last_success_at,recently_played_gap_risk')
      .eq('id', 1)
      .single<SyncState>();
    throwIfSupabaseError(stateError, 'Loading sync_state failed');
    if (!state) throw new Error('Loading sync_state returned no data');

    const accessToken = await refreshSpotifyAccessToken();
    const nowMs = Date.now();
    const effectiveAfter =
      state.recently_played_cursor_ms === null
        ? nowMs - TWENTY_FOUR_HOURS_MS
        : Math.max(0, state.recently_played_cursor_ms - TWO_HOURS_MS);

    const response = await getRecentlyPlayed(accessToken, effectiveAfter);
    const affectedDates = new Set<string>();
    const events = [];
    let maxCursor = state.recently_played_cursor_ms ?? 0;
    let minInsertedMs: number | null = null;

    for (const item of response.items) {
      const dimensions = await upsertTrackFromSpotify(supabase, item.track);
      const playedAtMs = unixMs(item.played_at);
      const localDate = localDateFor(item.played_at);
      const trackUri = item.track.uri ?? (item.track.id ? `spotify:track:${item.track.id}` : null);

      maxCursor = Math.max(maxCursor, playedAtMs);
      minInsertedMs = minInsertedMs === null ? playedAtMs : Math.min(minInsertedMs, playedAtMs);
      affectedDates.add(localDate);
      events.push({
        played_at: new Date(playedAtMs).toISOString(),
        local_date: localDate,
        source: SOURCE_RECENTLY_PLAYED,
        data_quality: QUALITY_API_UNKNOWN_DURATION,
        track_id: dimensions.trackId,
        primary_artist_id: dimensions.primaryArtistId,
        album_id: dimensions.albumId,
        ms_played: null,
        inferred_ms_played: null,
        skipped: null,
        context_uri: item.context?.uri ?? null,
        context_type: item.context?.type ?? null,
        source_event_key: apiSourceEventKey(item.played_at, trackUri)
      });
    }

    if (events.length > 0) {
      const { error } = await supabase
        .from('listening_events')
        .upsert(events, { onConflict: 'source_event_key', ignoreDuplicates: true });
      throwIfSupabaseError(error, 'Inserting recently played events failed');
    }

    const previousSuccessMs = state.recently_played_last_success_at
      ? unixMs(state.recently_played_last_success_at)
      : null;
    const gapRisk =
      state.recently_played_gap_risk ||
      response.items.length === 50 ||
      state.recently_played_cursor_ms === null ||
      (previousSuccessMs !== null && nowMs - previousSuccessMs > TWENTY_FOUR_HOURS_MS);

    const syncUpdate: Record<string, unknown> = {
      recently_played_cursor_ms: maxCursor || null,
      recently_played_last_success_at: new Date().toISOString(),
      recently_played_last_error_at: null,
      recently_played_last_error: null,
      recently_played_gap_risk: gapRisk,
      updated_at: new Date().toISOString()
    };

    if (minInsertedMs !== null) {
      syncUpdate.api_only_period_start = new Date(minInsertedMs).toISOString();
    }

    const { error: updateError } = await supabase.from('sync_state').update(syncUpdate).eq('id', 1);
    throwIfSupabaseError(updateError, 'Updating sync_state success failed');

    console.log(
      JSON.stringify(
        {
          fetched: response.items.length,
          attempted_inserts: events.length,
          affected_dates: uniqueSortedDates(affectedDates),
          gap_risk: gapRisk,
          cursor_ms: maxCursor || null
        },
        null,
        2
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markSyncError(message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
