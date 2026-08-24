import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_ROUTE_DIRS, stripDevRoutes } from '../../scripts/lib/dev-routes';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('dev route stripping', () => {
  it('declares at least one dev-only route', () => {
    expect(DEV_ROUTE_DIRS.length).toBeGreaterThan(0);
  });

  /* Derived from DEV_ROUTE_DIRS rather than naming routes: the list changes as
     dev tooling comes and goes, and a test that names today's entries fails on
     the rename rather than on the rule. */
  it('removes every declared dev route and leaves everything else alone', async () => {
    const buildDir = await mkdtemp(join(tmpdir(), 'strip-dev-'));
    for (const dir of DEV_ROUTE_DIRS) {
      await mkdir(join(buildDir, dir), { recursive: true });
      await writeFile(join(buildDir, dir, 'index.html'), '<html></html>');
    }
    await mkdir(join(buildDir, 'about'), { recursive: true });
    await writeFile(join(buildDir, 'about', 'index.html'), '<html></html>');

    const removed = await stripDevRoutes(buildDir);

    for (const dir of DEV_ROUTE_DIRS) {
      expect(await exists(join(buildDir, dir))).toBe(false);
      expect(removed).toContain(join(buildDir, dir));
    }
    expect(await exists(join(buildDir, 'about'))).toBe(true);
  });

  it('is idempotent when a dev route was never emitted', async () => {
    const buildDir = await mkdtemp(join(tmpdir(), 'strip-dev-'));
    await expect(stripDevRoutes(buildDir)).resolves.toBeInstanceOf(Array);
  });
});
