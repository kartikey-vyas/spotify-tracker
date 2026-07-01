import { adminClient, authenticatedUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/http.ts';

type Body = {
  slug?: string;
  displayName?: string;
  isPublic?: boolean;
};

function normalizeSlug(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeDisplayName(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return errorJson('Method not allowed', 405);

  try {
    const user = await authenticatedUser(req);
    const body = (await req.json()) as Body;
    const slug = normalizeSlug(body.slug);
    const displayName = normalizeDisplayName(body.displayName);

    if (!slug.match(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/)) {
      return errorJson('Slug must be 3-40 chars: lowercase letters, numbers, and hyphens');
    }
    if (displayName.length < 2 || displayName.length > 80) {
      return errorJson('Display name must be 2-80 characters');
    }

    const supabase = adminClient();
    const { data: existingProfile, error: existingError } = await supabase
      .from('profiles')
      .select('user_id,slug,display_name,is_public')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingProfile) {
      return json({ profile: existingProfile, alreadyOnboarded: true });
    }

    if (!user.app_metadata?.invited) {
      return errorJson('This account was not invited', 403);
    }

    const { data: slugOwner, error: slugError } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('slug', slug)
      .maybeSingle<{ user_id: string }>();
    if (slugError) throw slugError;
    if (slugOwner) return errorJson('Profile slug is already taken', 409);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        user_id: user.id,
        slug,
        display_name: displayName,
        is_public: Boolean(body.isPublic),
        onboarding_completed_at: new Date().toISOString()
      })
      .select('user_id,slug,display_name,is_public')
      .single();
    if (profileError) throw profileError;

    const { error: stateError } = await supabase.from('sync_state').upsert(
      {
        id: 1,
        user_id: user.id,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );
    if (stateError) throw stateError;

    return json({ profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorJson(message, message === 'Not authenticated' ? 401 : 400);
  }
});
