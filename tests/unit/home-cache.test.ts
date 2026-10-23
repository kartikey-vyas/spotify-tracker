import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readCachedProfiles,
  readHomeSnapshot,
  saveCachedProfiles,
  saveHomeSnapshot
} from '../../src/lib/homeCache';
import type { HomeBand } from '../../src/lib/queries/home';
import type { OverviewPayload } from '../../src/lib/types';

class MemoryStorage {
  items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const overview = { generated_at: '2026-10-23T00:00:00Z', calendar: { daily: [] } } as unknown as OverviewPayload;
const band = (name: string): HomeBand => ({
  artists: [
    {
      entity_id: '1',
      entity_name: name,
      minutes: 0,
      plays: 1,
      qualified_plays: 0,
      unique_tracks: 1,
      skipped_count: 0,
      known_skip_count: 0,
      unknown_duration_plays: 1
    }
  ],
  tracks: [],
  albums: []
});

let memory: MemoryStorage;

beforeEach(() => {
  memory = new MemoryStorage();
  vi.stubGlobal('localStorage', memory);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('home snapshot', () => {
  it('reads back what was saved, per profile', () => {
    saveHomeSnapshot('a', { overview, bands: { '30d': band('A') } });
    expect(readHomeSnapshot('a')).toEqual({ overview, bands: { '30d': band('A') } });
    expect(readHomeSnapshot('b')).toEqual({});
  });

  it('merges windows instead of replacing them', () => {
    saveHomeSnapshot('a', { overview, bands: { '30d': band('thirty') } });
    saveHomeSnapshot('a', { bands: { '7d': band('seven') } });
    const snapshot = readHomeSnapshot('a');
    expect(snapshot.overview).toEqual(overview);
    expect(snapshot.bands?.['30d']).toEqual(band('thirty'));
    expect(snapshot.bands?.['7d']).toEqual(band('seven'));
  });

  it('drops parts that do not look like what the page expects', () => {
    saveHomeSnapshot('a', { overview });
    const [key] = memory.items.keys();
    memory.setItem(key, JSON.stringify({ overview: { calendar: {} }, bands: { '30d': { artists: [] } } }));
    expect(readHomeSnapshot('a')).toEqual({ bands: {} });
    memory.setItem(key, '{not json');
    expect(readHomeSnapshot('a')).toEqual({});
  });

  it('works without storage, and when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      }
    });
    expect(() => saveHomeSnapshot('a', { overview })).not.toThrow();
    expect(readHomeSnapshot('a')).toEqual({});
    vi.stubGlobal('localStorage', undefined);
    expect(readCachedProfiles()).toBeNull();
  });
});

describe('cached profiles', () => {
  it('round-trips a valid list and rejects a malformed one', () => {
    const profiles = [{ slug: 'a', display_name: 'A', generated_at: 'x' }];
    saveCachedProfiles(profiles);
    expect(readCachedProfiles()).toEqual(profiles);
    saveCachedProfiles([{ slug: 'a' }] as never);
    expect(readCachedProfiles()).toBeNull();
  });
});
