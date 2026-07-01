import { optionalEnv } from './lib/env.js';
import { createServiceClient, throwIfSupabaseError } from './lib/supabase-admin.js';

function stringArg(name: string): string | null {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3).trim() : null;
}

function emailArg(): string {
  const flag = stringArg('email');
  const positional = process.argv.slice(2).find((value) => !value.startsWith('--'));
  const email = (flag ?? positional ?? '').trim().toLowerCase();
  if (!email) {
    throw new Error('Usage: pnpm invite <email> [--display-name=..] [--site-url=..]');
  }
  return email;
}

function redirectUrl(): string {
  const siteUrl = stringArg('site-url') ?? optionalEnv('SITE_URL');
  if (!siteUrl) {
    throw new Error('Set --site-url= or SITE_URL to the app URL (e.g. https://.../app/)');
  }
  return siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
}

async function main(): Promise<void> {
  const email = emailArg();
  const displayName = stringArg('display-name');
  const redirectTo = redirectUrl();
  const supabase = createServiceClient();

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: displayName ? { display_name: displayName } : undefined
  });

  if (error) {
    const lower = error.message.toLowerCase();
    if (lower.includes('already') && (lower.includes('registered') || lower.includes('exist'))) {
      throw new Error(`${email} is already a member (or already invited).`);
    }
    throwIfSupabaseError(error, 'Inviting user failed');
  }

  console.log(JSON.stringify({ invited: data.user?.email ?? email, redirectTo }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
