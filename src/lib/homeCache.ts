import type { HomeBand } from '$lib/queries/home';
import type { InsightsPayload, OverviewPayload, PublicProfileOption } from '$lib/types';

/* The last homepage data this browser saw, per profile, so a repeat visit can
   paint at once and refresh in the background. Everything here is public data.
   It is a per-viewer convenience only: storage can be missing, full or blocked,
   so every read and write is guarded and a miss just means a normal load.

   Bump VERSION when a stored shape changes; older entries are then ignored. */

const VERSION = 1;
const PREFIX = `musik:home:v${VERSION}:`;
const PROFILES_KEY = `${PREFIX}profiles`;

export type BandWindow = '7d' | '30d';

export type HomeSnapshot = {
  overview?: OverviewPayload | null;
  insights?: InsightsPayload | null;
  bands?: Partial<Record<BandWindow, HomeBand>>;
};

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const text = storage()?.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the page still works, just without the head start.
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isOverview(value: unknown): value is OverviewPayload {
  return isObject(value) && typeof value.generated_at === 'string' && isObject(value.calendar);
}

function isBand(value: unknown): value is HomeBand {
  return (
    isObject(value) &&
    Array.isArray(value.artists) &&
    Array.isArray(value.tracks) &&
    Array.isArray(value.albums)
  );
}

/** What is stored for a profile, keeping only the parts that still look right. */
export function readHomeSnapshot(slug: string): HomeSnapshot {
  const raw = readJson(PREFIX + slug);
  if (!isObject(raw)) return {};

  const snapshot: HomeSnapshot = {};
  if (isOverview(raw.overview)) snapshot.overview = raw.overview;
  if (isObject(raw.insights) && typeof raw.insights.generated_at === 'string') {
    snapshot.insights = raw.insights as InsightsPayload;
  }
  if (isObject(raw.bands)) {
    const bands: Partial<Record<BandWindow, HomeBand>> = {};
    for (const window of ['7d', '30d'] as const) {
      if (isBand(raw.bands[window])) bands[window] = raw.bands[window] as HomeBand;
    }
    snapshot.bands = bands;
  }
  return snapshot;
}

/** Merges fresh data into a profile's snapshot. */
export function saveHomeSnapshot(slug: string, patch: HomeSnapshot): void {
  const current = readHomeSnapshot(slug);
  writeJson(PREFIX + slug, {
    ...current,
    ...patch,
    bands: { ...current.bands, ...patch.bands }
  });
}

export function readCachedProfiles(): PublicProfileOption[] | null {
  const raw = readJson(PROFILES_KEY);
  if (!Array.isArray(raw)) return null;
  return raw.every((row) => isObject(row) && typeof row.slug === 'string' && typeof row.display_name === 'string')
    ? (raw as PublicProfileOption[])
    : null;
}

export function saveCachedProfiles(profiles: PublicProfileOption[]): void {
  writeJson(PROFILES_KEY, profiles);
}
