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
  it('lists loader and sprites as dev-only routes', () => {
    expect(DEV_ROUTE_DIRS).toContain('loader');
    expect(DEV_ROUTE_DIRS).toContain('sprites');
  });

  it('removes dev route directories and leaves everything else alone', async () => {
    const buildDir = await mkdtemp(join(tmpdir(), 'strip-dev-'));
    await mkdir(join(buildDir, 'loader'), { recursive: true });
    await writeFile(join(buildDir, 'loader', 'index.html'), '<html></html>');
    await mkdir(join(buildDir, 'about'), { recursive: true });
    await writeFile(join(buildDir, 'about', 'index.html'), '<html></html>');

    const removed = await stripDevRoutes(buildDir);

    expect(await exists(join(buildDir, 'loader'))).toBe(false);
    expect(await exists(join(buildDir, 'about'))).toBe(true);
    expect(removed).toContain(join(buildDir, 'loader'));
  });

  it('is idempotent when a dev route was never emitted', async () => {
    const buildDir = await mkdtemp(join(tmpdir(), 'strip-dev-'));
    await expect(stripDevRoutes(buildDir)).resolves.toBeInstanceOf(Array);
  });
});
