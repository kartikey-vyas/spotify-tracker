import { createHash } from 'node:crypto';

export function sha256(parts: Array<string | number | boolean | null | undefined>): string {
  const normalized = parts.map((part) => String(part ?? '')).join('\u001f');
  return createHash('sha256').update(normalized).digest('hex');
}
