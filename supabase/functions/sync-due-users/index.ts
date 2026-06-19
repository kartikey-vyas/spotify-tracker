import { adminClient, assertServiceRequest } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/http.ts';
import { decryptString, encryptString, sha256Hex } from '../_shared/crypto.ts';
import { localDateFor, uniqueSortedDates, unixMs } from '../_shared/dates.ts';
import { upsertTrackFromSpotify } from '../_shared/dimensions.ts';
import { getRecentlyPlayed, refreshSpotifyAccessToken } from '../_shared/spotify.ts';
import { requireEnv } from '../_shared/env.ts';

const SOURCE_RECENTLY_PLAYED = 2;
const QUALITY_API_UNKNOWN_DURATION = 2;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

type Connection = {
  user_id: string;
  refresh_token_ciphertext: string;
  refresh_token_nonce: string;
};

type SyncState = {
  recently_played_cursor_ms: number | null;
  recently_played_last_success_at: string | null;
  recently_played_gap_risk: boolean;
};

async function sourceEventKey(playedAt: string, trackUri: string | null | undefined): Promise<string> {
  return sha256Hex(['recently_played_api', playedAt, trackUri ?? ''].join('\u001f'));
}

async function markUserSyncError(userId: string, message: string): Promise<void> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  await supabase
    .from('sync_state')
    .upsert(
      {
        id: 1,
        user_id: userId,
        recently_played_last_error_at: now,
        recently_played_last_error: message.slice(0, 1000),
        recently_played_gap_risk: true,
        updated_at: now
      },
      { onConflict: 'user_id' }
    );

  await supabase
    .from('spotify_connections')
    .update({
      last_error_at: now,
      last_error: message.slice(0, 1000),
      updated_at: now
    })
    .eq('user_id', userId);
}

async function syncUser(connection: Connection): Promise<Record<string, unknown>> {
  const supabase = adminClient();
  const { data: state, error: stateError } = await supabase
    .from('sync_state')
    .select('recently_played_cursor_ms,recently_played_last_success_at,recently_played_gap_risk')
    .eq('user_id', connection.user_id)
    .maybeSingle<SyncState>();
  if (stateError) throw stateError;

  const encryptionKey = requireEnv('SPOTIFY_TOKEN_ENCRYPTION_KEY');
  const refreshToken = await decryptString(
    connection.refresh_token_ciphertext,
    connection.refresh_token_nonce,
    encryptionKey
  );
  const token = await refreshSpotifyAccessToken(refreshToken);
  const now = new Date();
  const nowMs = now.getTime();
  const effectiveAfter =
    state?.recently_played_cursor_ms === null || state?.recently_played_cursor_ms === undefined
      ? nowMs - TWENTY_FOUR_HOURS_MS
      : Math.max(0, state.recently_played_cursor_ms - TWO_HOURS_MS);

  const response = await getRecentlyPlayed(token.access_token, effectiveAfter);
  const affectedDates = new Set<string>();
  const events = [];
  let maxCursor = state?.recently_played_cursor_ms ?? 0;
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
      user_id: connection.user_id,
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
      source_event_key: await sourceEventKey(item.played_at, trackUri)
    });
  }

  if (events.length > 0) {
    const { error } = await supabase
      .from('listening_events')
      .upsert(events, { onConflict: 'user_id,source_event_key', ignoreDuplicates: true });
    if (error) throw error;
  }

  const previousSuccessMs = state?.recently_played_last_success_at
    ? unixMs(state.recently_played_last_success_at)
    : null;
  const gapRisk =
    Boolean(state?.recently_played_gap_risk) ||
    response.items.length === 50 ||
    !state?.recently_played_cursor_ms ||
    (previousSuccessMs !== null && nowMs - previousSuccessMs > TWENTY_FOUR_HOURS_MS);

  const syncUpdate: Record<string, unknown> = {
    id: 1,
    user_id: connection.user_id,
    recently_played_cursor_ms: maxCursor || null,
    recently_played_last_success_at: now.toISOString(),
    recently_played_last_error_at: null,
    recently_played_last_error: null,
    recently_played_gap_risk: gapRisk,
    updated_at: now.toISOString()
  };

  if (minInsertedMs !== null) {
    syncUpdate.api_only_period_start = new Date(minInsertedMs).toISOString();
  }

  const { error: stateUpdateError } = await supabase
    .from('sync_state')
    .upsert(syncUpdate, { onConflict: 'user_id' });
  if (stateUpdateError) throw stateUpdateError;

  if (token.refresh_token) {
    const encrypted = await encryptString(token.refresh_token, encryptionKey);
    const { error: tokenUpdateError } = await supabase
      .from('spotify_connections')
      .update({
        refresh_token_ciphertext: encrypted.ciphertext,
        refresh_token_nonce: encrypted.nonce,
        token_encrypted_at: now.toISOString(),
        last_token_refresh_at: now.toISOString(),
        last_error_at: null,
        last_error: null,
        updated_at: now.toISOString()
      })
      .eq('user_id', connection.user_id);
    if (tokenUpdateError) throw tokenUpdateError;
  } else {
    const { error: tokenUpdateError } = await supabase
      .from('spotify_connections')
      .update({
        last_token_refresh_at: now.toISOString(),
        last_error_at: null,
        last_error: null,
        updated_at: now.toISOString()
      })
      .eq('user_id', connection.user_id);
    if (tokenUpdateError) throw tokenUpdateError;
  }

  const dates = uniqueSortedDates(affectedDates);
  const { error: refreshError } = await supabase.rpc('refresh_user_public_stats', {
    p_user_id: connection.user_id,
    target_dates: dates.length > 0 ? dates : null
  });
  if (refreshError) throw refreshError;

  return {
    user_id: connection.user_id,
    fetched: response.items.length,
    attempted_inserts: events.length,
    affected_dates: dates,
    gap_risk: gapRisk,
    cursor_ms: maxCursor || null
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return errorJson('Method not allowed', 405);

  try {
    assertServiceRequest(req);
    const supabase = adminClient();
    const staleMinutes = Number(Deno.env.get('SYNC_STALE_MINUTES') ?? '14');
    const limit = Number(Deno.env.get('SYNC_USER_LIMIT') ?? '10');
    const staleBeforeMs = Date.now() - staleMinutes * 60 * 1000;

    const { data: connections, error: connectionsError } = await supabase
      .from('spotify_connections')
      .select('user_id,refresh_token_ciphertext,refresh_token_nonce')
      .eq('sync_enabled', true)
      .order('updated_at', { ascending: true })
      .limit(Math.max(1, Math.min(limit * 3, 50)))
      .returns<Connection[]>();
    if (connectionsError) throw connectionsError;

    const results = [];
    for (const connection of connections ?? []) {
      if (results.length >= limit) break;

      const { data: state, error: stateError } = await supabase
        .from('sync_state')
        .select('recently_played_last_success_at')
        .eq('user_id', connection.user_id)
        .maybeSingle<{ recently_played_last_success_at: string | null }>();
      if (stateError) throw stateError;

      const lastSuccessMs = state?.recently_played_last_success_at
        ? unixMs(state.recently_played_last_success_at)
        : 0;
      if (lastSuccessMs > staleBeforeMs) continue;

      try {
        results.push(await syncUser(connection));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markUserSyncError(connection.user_id, message);
        results.push({
          user_id: connection.user_id,
          error: message
        });
      }
    }

    return json({ processed: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorJson(message, message === 'Invalid service credential' ? 401 : 400);
  }
});
