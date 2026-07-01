const GENERIC = 'Something went wrong. Please try again.';

export function friendlyAuthError(raw: string | null | undefined): string {
  const msg = (raw ?? '').trim();
  if (!msg) return GENERIC;

  const lower = msg.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return 'That email is already a member — try signing in instead.';
  }
  if (lower.includes('password') && lower.includes('at least')) {
    return 'Password must be at least 8 characters.';
  }
  return msg;
}

export function friendlyLinkError(
  code: string | null | undefined,
  description: string | null | undefined
): string | null {
  if (!code && !description) return null;
  return 'This link has already been used or has expired. Sign in below, or ask for a fresh invite or reset link.';
}
