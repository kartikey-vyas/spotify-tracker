import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Routes that exist only in development. Their page content is dev-gated so it
 * constant-folds out of the production bundle; this list removes the empty
 * prerendered shells that adapter-static still emits for them.
 */
export const DEV_ROUTE_DIRS: readonly string[] = ['loader'];

/** Removes each dev route directory from a build output. Returns what it targeted. */
export async function stripDevRoutes(buildDir: string): Promise<string[]> {
  const removed: string[] = [];
  for (const dir of DEV_ROUTE_DIRS) {
    const target = join(buildDir, dir);
    await rm(target, { recursive: true, force: true });
    removed.push(target);
  }
  return removed;
}
