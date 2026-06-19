import { adminClient } from '../_shared/supabase.ts';
import { errorJson, json, redirectWithParams } from '../_shared/http.ts';
import { encryptString, sha256Hex } from '../_shared/crypto.ts';
import { exchangeSpotifyCode, getSpotifyMe, spotifyScopes } from '../_shared/spotify.ts';
import { requireEnv } from '../_shared/env.ts';

function fallbackRedirect(): string {
  return Deno.env.get('SITE_URL') ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/spotify-callback`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'GET') return errorJson('Method not allowed', 405);

  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  let redirectTo = fallbackRedirect();

  try {
    if (error) throw new Error(error);
    if (!code || !state) throw new Error('Missing Spotify code or state');

    const supabase = adminClient();
    const stateHash = await sha256Hex(state);
    const { data: storedState, error: stateError } = await supabase
      .from('spotify_oauth_states')
      .select('state_hash,user_id,redirect_to,expires_at,used_at')
      .eq('state_hash', stateHash)
      .maybeSingle<{
        state_hash: string;
        user_id: string;
        redirect_to: string | null;
        expires_at: string;
        used_at: string | null;
      }>();
    if (stateError) throw stateError;
    if (!storedState) throw new Error('Invalid Spotify OAuth state');
    redirectTo = storedState.redirect_to ?? redirectTo;
    if (storedState.used_at) throw new Error('Spotify OAuth state has already been used');
    if (Date.parse(storedState.expires_at) <= Date.now()) throw new Error('Spotify OAuth state expired');

    const token = await exchangeSpotifyCode(code);
    if (!token.refresh_token) throw new Error('Spotify did not return a refresh token');
    const spotifyMe = await getSpotifyMe(token.access_token);
    const encrypted = await encryptString(token.refresh_token, requireEnv('SPOTIFY_TOKEN_ENCRYPTION_KEY'));
    const now = new Date().toISOString();

    const { error: connectionError } = await supabase.from('spotify_connections').upsert(
      {
        user_id: storedState.user_id,
        spotify_user_id: spotifyMe.id,
        spotify_display_name: spotifyMe.display_name ?? null,
        scopes: token.scope ? token.scope.split(' ') : spotifyScopes(),
        refresh_token_ciphertext: encrypted.ciphertext,
        refresh_token_nonce: encrypted.nonce,
        token_encrypted_at: now,
        sync_enabled: true,
        connected_at: now,
        last_token_refresh_at: now,
        last_error_at: null,
        last_error: null,
        updated_at: now
      },
      { onConflict: 'user_id' }
    );
    if (connectionError) throw connectionError;

    const { error: stateUpdateError } = await supabase
      .from('spotify_oauth_states')
      .update({ used_at: now })
      .eq('state_hash', storedState.state_hash);
    if (stateUpdateError) throw stateUpdateError;

    const { error: syncStateError } = await supabase.from('sync_state').upsert(
      {
        id: 1,
        user_id: storedState.user_id,
        updated_at: now
      },
      { onConflict: 'user_id' }
    );
    if (syncStateError) throw syncStateError;

    return redirectWithParams(redirectTo, { spotify: 'connected' });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return redirectWithParams(redirectTo, { spotify: 'error', message });
  }
});

