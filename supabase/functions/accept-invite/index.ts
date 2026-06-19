import { adminClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/http.ts';
import { sha256Hex } from '../_shared/crypto.ts';

type Body = {
  code?: string;
  email?: string;
  slug?: string;
  displayName?: string;
  isPublic?: boolean;
};

type InviteRow = {
  code_hash: string;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const slugPattern = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function normalizeEmail(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeSlug(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeDisplayName(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

async function cleanupUser(userId: string): Promise<void> {
  const { error } = await adminClient().auth.admin.deleteUser(userId);
  if (error) console.error(`Failed to clean up auth user ${userId}: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return errorJson('Method not allowed', 405);

  let createdUserId: string | null = null;

  try {
    const body = (await req.json()) as Body;
    const code = (body.code ?? '').trim().toLowerCase();
    const email = normalizeEmail(body.email);
    const slug = normalizeSlug(body.slug);
    const displayName = normalizeDisplayName(body.displayName);

    if (!code) return errorJson('Invite link is missing a code');
    if (!emailPattern.test(email)) return errorJson('Enter a valid email address');
    if (!slugPattern.test(slug)) {
      return errorJson('Slug must be 3-40 chars: lowercase letters, numbers, and hyphens');
    }
    if (displayName.length < 2 || displayName.length > 80) {
      return errorJson('Display name must be 2-80 characters');
    }

    const supabase = adminClient();
    const codeHash = await sha256Hex(code);

    const { data: invite, error: inviteError } = await supabase
      .from('invite_codes')
      .select('code_hash,max_uses,use_count,expires_at')
      .eq('code_hash', codeHash)
      .maybeSingle<InviteRow>();
    if (inviteError) throw inviteError;
    if (!invite) return errorJson('Invite link is not valid', 403);
    if (invite.expires_at && Date.parse(invite.expires_at) <= Date.now()) {
      return errorJson('Invite link has expired', 403);
    }
    if (invite.use_count >= invite.max_uses) return errorJson('Invite link has already been used', 403);

    const { data: slugOwner, error: slugError } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('slug', slug)
      .maybeSingle<{ user_id: string }>();
    if (slugError) throw slugError;
    if (slugOwner) return errorJson('Profile slug is already taken', 409);

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        display_name: displayName
      },
      app_metadata: {
        invited: true
      }
    });
    if (authError) return errorJson(authError.message, 409);
    if (!authData.user) throw new Error('Auth user was not created');
    createdUserId = authData.user.id;

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        user_id: createdUserId,
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
        user_id: createdUserId,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );
    if (stateError) throw stateError;

    const acceptedAt = new Date().toISOString();
    const { data: consumedRows, error: consumeError } = await supabase
      .from('invite_codes')
      .update({
        use_count: invite.use_count + 1,
        last_used_at: acceptedAt,
        accepted_at: acceptedAt,
        accepted_email: email,
        accepted_user_id: createdUserId
      })
      .eq('code_hash', invite.code_hash)
      .eq('use_count', invite.use_count)
      .select('code_hash');
    if (consumeError) throw consumeError;
    if (!consumedRows || consumedRows.length !== 1) {
      throw new Error('Invite link was used before this request completed');
    }

    return json({
      email,
      profile,
      magicLinkReady: true
    });
  } catch (error) {
    if (createdUserId) await cleanupUser(createdUserId);
    const message = error instanceof Error ? error.message : String(error);
    return errorJson(message);
  }
});
