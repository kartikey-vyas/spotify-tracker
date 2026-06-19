import { randomBytes, createHash } from 'node:crypto';
import { createServiceClient, throwIfSupabaseError } from './lib/supabase-admin.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function codeFromArgs(): string {
  const explicit = process.argv.find((arg) => arg.startsWith('--code='));
  if (explicit) return explicit.slice('--code='.length).trim().toLowerCase();
  return randomBytes(9).toString('base64url').toLowerCase();
}

function numberArg(name: string, fallback: number): number {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const parsed = Number(arg.slice(name.length + 3));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

function stringArg(name: string): string | null {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3).trim() : null;
}

async function main(): Promise<void> {
  const code = codeFromArgs();
  const maxUses = numberArg('max-uses', 1);
  const label = stringArg('label');
  const expiresAt = stringArg('expires-at');
  const supabase = createServiceClient();

  const { error } = await supabase.from('invite_codes').insert({
    code_hash: sha256(code),
    label,
    max_uses: maxUses,
    expires_at: expiresAt
  });
  throwIfSupabaseError(error, 'Creating invite code failed');

  console.log(
    JSON.stringify(
      {
        code,
        max_uses: maxUses,
        label,
        expires_at: expiresAt
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

