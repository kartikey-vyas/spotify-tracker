const SUPPORTED_ROUTES = new Set(['/', '/explore/', '/activity/', '/about/']);

/** Viewports at or below this width get no ambient population (summon still works). */
export const AMBIENT_MIN_VIEWPORT_WIDTH = 800;

export function ambientPixelPersonPopulation(viewportWidth: number): number {
  return viewportWidth > AMBIENT_MIN_VIEWPORT_WIDTH ? 1 : 0;
}

export function normalizePixelPersonPath(pathname: string, basePath = ''): string {
  let path = pathname;
  if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length) || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  if (!path.endsWith('/')) path += '/';
  return path;
}

export function isPixelPersonRoute(pathname: string, basePath = ''): boolean {
  return SUPPORTED_ROUTES.has(normalizePixelPersonPath(pathname, basePath));
}

export function shouldEnablePixelPerson(
  pathname: string,
  viewportWidth: number,
  reducedMotion: boolean,
  basePath = '',
  manuallySummoned = false
): boolean {
  return (
    (ambientPixelPersonPopulation(viewportWidth) > 0 || manuallySummoned) &&
    !reducedMotion &&
    isPixelPersonRoute(pathname, basePath)
  );
}
