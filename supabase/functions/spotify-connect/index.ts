import { adminClient, authenticatedUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/http.ts';
import { randomToken, sha256Hex } from '../_shared/crypto.ts';
import { spotifyAuthUrl } from '../_shared/spotify.ts';

type Body = {
  redirectTo?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return errorJson('Method not allowed', 405);

  try {
    const user = await authenticatedUser(req);
    const body = (await req.json().catch(() => ({}))) as Body;
    const supabase = adminClient();

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return errorJson('Complete onboarding before connecting Spotify', 403);

    const state = randomToken(32);
    const stateHash = await sha256Hex(state);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: stateError } = await supabase.from('spotify_oauth_states').insert({
      state_hash: stateHash,
      user_id: user.id,
      redirect_to: body.redirectTo ?? null,
      expires_at: expiresAt
    });
    if (stateError) throw stateError;

    return json({ url: spotifyAuthUrl(state) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorJson(message, message === 'Not authenticated' ? 401 : 400);
  }
});

