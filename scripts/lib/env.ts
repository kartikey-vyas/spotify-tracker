import { existsSync } from 'node:fs';
import { config } from 'dotenv';

for (const path of ['.env.local', '.env']) {
  if (existsSync(path)) {
    config({ path, override: false });
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}
