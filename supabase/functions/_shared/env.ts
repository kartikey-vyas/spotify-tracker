export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseKeyMap(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return Object.values(parsed).filter(Boolean);
  } catch {
    return [];
  }
}

export function publishableKey(): string {
  const keys = parseKeyMap(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'));
  return keys[0] ?? requireEnv('SUPABASE_ANON_KEY');
}

// Single-value secret env vars, in precedence order. `SUPABASE_SECRET_KEYS`
// (a JSON map) is checked ahead of these.
const SECRET_KEY_ENV_VARS = ['SUPABASE_SECRET_KEY', 'SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

export function secretKeys(): string[] {
  return [
    ...parseKeyMap(Deno.env.get('SUPABASE_SECRET_KEYS')),
    ...SECRET_KEY_ENV_VARS.map((name) => Deno.env.get(name))
  ].filter((value): value is string => Boolean(value));
}

export function secretKey(): string {
  const [first] = secretKeys();
  if (!first) {
    throw new Error(`SUPABASE_SECRET_KEYS or one of ${SECRET_KEY_ENV_VARS.join(', ')} is required`);
  }
  return first;
}
