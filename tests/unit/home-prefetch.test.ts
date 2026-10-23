import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/supabase', () => ({ supabase: null }));

import { getPresetDateRange } from '../../src/lib/dateRanges';
import {
  bootHomePrefetch,
  homePrefetchScript,
  takeHomePrefetch,
  type HomePrefetchConfig
} from '../../src/lib/homePrefetch';

const CONFIG: HomePrefetchConfig = {
  url: 'https://example.supabase.co',
  key: 'sb_publishable_test',
  defaultSlug: 'default-slug',
  listLimit: 8,
  albumLimit: 36
};

type Answer = { ok: boolean; status: number; body: unknown };

function fakeFetch(answer: (url: string) => Answer) {
  const urls: string[] = [];
  const fetch = (url: string) => {
    urls.push(url);
    const { ok, status, body } = answer(url);
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);
  };
  return { fetch, urls };
}

function boot(search: string, now: number, answer: (url: string) => Answer = () => ({ ok: true, status: 200, body: [] })) {
  const target: Record<string, unknown> = {};
  const { fetch, urls } = fakeFetch(answer);
  bootHomePrefetch(CONFIG, { search, now, fetch, target });
  return { target, urls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('bootHomePrefetch', () => {
  // Around Melbourne midnight and both daylight-saving changes, where a naive
  // UTC or local-time date would land on the wrong day.
  const INSTANTS = [
    '2026-10-23T12:59:59Z',
    '2026-10-23T13:00:00Z',
    '2026-04-04T15:59:59Z',
    '2026-04-04T16:00:00Z',
    '2026-10-03T15:59:59Z',
    '2026-10-03T16:00:00Z',
    '2026-12-31T13:30:00Z'
  ];

  it('asks for the same 30-day range as the page', () => {
    for (const iso of INSTANTS) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(iso));
      const { target } = boot('', Date.now());
      const raw = target.__musikHomePrefetch as { start: string; end: string };
      expect({ start: raw.start, end: raw.end }, iso).toEqual(getPresetDateRange('last_30_days'));
    }
  });

  it('uses the slug from the URL, else the default', () => {
    expect((boot('?slug=someone', Date.now()).target.__musikHomePrefetch as { slug: string }).slug).toBe('someone');
    expect((boot('', Date.now()).target.__musikHomePrefetch as { slug: string }).slug).toBe('default-slug');
    expect((boot('?slug=', Date.now()).target.__musikHomePrefetch as { slug: string }).slug).toBe('default-slug');
  });

  it('sends every request with the key in the query string and no headers', () => {
    const { urls } = boot('?slug=a%26b', Date.now());
    expect(urls).toHaveLength(4);
    for (const url of urls) {
      expect(url.startsWith(`${CONFIG.url}/rest/v1/`)).toBe(true);
      expect(new URL(url).searchParams.get('apikey')).toBe(CONFIG.key);
    }
    const band = new URL(urls.find((url) => url.includes('/rpc/public_profile_home_band'))!);
    expect(band.searchParams.get('p_slug')).toBe('a&b');
    expect(band.searchParams.get('p_album_limit')).toBe('36');
  });
});

describe('homePrefetchScript', () => {
  it('runs on its own, with only the page globals it is given', async () => {
    const script = homePrefetchScript(CONFIG);
    expect(script.startsWith('<script>')).toBe(true);
    const body = script.slice('<script>'.length, -'</script>'.length);
    const window: Record<string, unknown> = {};
    const { fetch, urls } = fakeFetch(() => ({ ok: true, status: 200, body: [] }));
    // No module scope: any reference the build leaves outside the function fails here.
    new Function('location', 'fetch', 'window', body)({ search: '?slug=x' }, fetch, window);
    expect(urls).toHaveLength(4);
    expect((window.__musikHomePrefetch as { slug: string }).slug).toBe('x');
  });

  it('cannot be closed early by a config value', () => {
    const script = homePrefetchScript({ ...CONFIG, defaultSlug: '</script><b>' });
    expect(script.indexOf('</script>')).toBe(script.length - '</script>'.length);
  });
});

describe('takeHomePrefetch', () => {
  const range = getPresetDateRange('last_30_days');

  it('hands over parsed responses once', async () => {
    const overview = { generated_at: 'x', calendar: {} };
    const { target } = boot('', Date.now(), (url) => {
      if (url.includes('select=payload')) return { ok: true, status: 200, body: [{ payload: overview }] };
      if (url.includes('/rpc/')) {
        return {
          ok: true,
          status: 200,
          body: { artists: [{ entity_id: '1', entity_name: 'A', minutes: '1.5', plays: 2 }], tracks: [], albums: [] }
        };
      }
      return { ok: true, status: 200, body: [{ slug: 'default-slug', display_name: 'D', generated_at: 'x' }] };
    });

    const taken = takeHomePrefetch(target, 'default-slug', range);
    expect(taken).not.toBeNull();
    expect(await taken!.overview).toEqual(overview);
    expect((await taken!.profiles)[0].slug).toBe('default-slug');
    const band = await taken!.band;
    expect(band.artists[0]).toMatchObject({ entity_id: '1', minutes: 1.5, plays: 2 });
    expect(takeHomePrefetch(target, 'default-slug', range)).toBeNull();
  });

  it('ignores requests made for another slug or range', () => {
    expect(takeHomePrefetch(boot('', Date.now()).target, 'someone-else', range)).toBeNull();
    expect(
      takeHomePrefetch(boot('', Date.now()).target, 'default-slug', { start: '2000-01-01', end: range.end })
    ).toBeNull();
  });

  it('turns an error response into a rejection with the server message', async () => {
    const { target } = boot('', Date.now(), () => ({ ok: false, status: 500, body: { message: 'canceling statement' } }));
    const taken = takeHomePrefetch(target, 'default-slug', range)!;
    await expect(taken.overview).rejects.toThrow('canceling statement');
  });

  it('is null when no boot script ran', () => {
    expect(takeHomePrefetch({}, 'default-slug', range)).toBeNull();
  });
});
