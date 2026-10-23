import type { HomeBand } from '$lib/queries/home';
import { parseHomeBand } from '$lib/queries/home';
import type { InsightsPayload, OverviewPayload, PublicProfileOption } from '$lib/types';

/* Starts the homepage's first requests from an inline <head> script, while the
   app's JavaScript is still downloading, instead of after it has loaded and
   hydrated. The page picks the requests up with takeHomePrefetch.

   The requests are plain GETs with the key in the query string, so the browser
   sends them without a CORS preflight; the supabase-js client sends headers
   that need one. The RPC is stable, which is what lets PostgREST serve it over
   GET. */

export type HomePrefetchConfig = {
  url: string;
  key: string;
  defaultSlug: string;
  listLimit: number;
  albumLimit: number;
};

type BootEnv = {
  search: string;
  now: number;
  fetch: (url: string) => Promise<Response>;
  target: Record<string, unknown>;
};

type RawPrefetch = {
  slug: string;
  start: string;
  end: string;
  profiles: Promise<unknown>;
  overview: Promise<unknown>;
  insights: Promise<unknown>;
  band: Promise<unknown>;
};

const GLOBAL_KEY = '__musikHomePrefetch';

/* Serialised into the page with toString(), so it must not reference anything
   outside its own body: no imports, no module constants. Plain ES5-style code
   keeps it readable after the build. The date logic mirrors
   getPresetDateRange('last_30_days'); takeHomePrefetch ignores the result if
   the two ever disagree, so a mismatch costs speed but not correctness. */
export function bootHomePrefetch(config: HomePrefetchConfig, env: BootEnv): void {
  try {
    var slug = new URLSearchParams(env.search).get('slug') || config.defaultSlug;
    var parts: Record<string, string> = {};
    new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(new Date(env.now))
      .forEach(function (part) {
        parts[part.type] = part.value;
      });
    var today = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12);
    var end = new Date(today).toISOString().slice(0, 10);
    var start = new Date(today - 29 * 86400000).toISOString().slice(0, 10);

    var get = function (path: string): Promise<unknown> {
      var request = env
        .fetch(config.url + '/rest/v1/' + path + '&apikey=' + encodeURIComponent(config.key))
        .then(function (response) {
          if (response.ok) return response.json();
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (body: { message?: string } | null) {
              throw new Error((body && body.message) || 'HTTP ' + response.status);
            });
        });
      // Marks the promise handled: a failure surfaces where the page awaits it.
      request.catch(function () {});
      return request;
    };
    var slugParam = encodeURIComponent(slug);

    env.target['__musikHomePrefetch'] = {
      slug: slug,
      start: start,
      end: end,
      profiles: get('public_profile_overview?select=slug,display_name,generated_at&order=display_name.asc'),
      overview: get('public_profile_overview?select=payload&slug=eq.' + slugParam),
      insights: get('public_profile_insights?select=payload&slug=eq.' + slugParam),
      band: get(
        'rpc/public_profile_home_band?p_slug=' +
          slugParam +
          '&p_start_date=' +
          start +
          '&p_end_date=' +
          end +
          '&p_list_limit=' +
          config.listLimit +
          '&p_album_limit=' +
          config.albumLimit
      )
    };
  } catch (error) {
    // Anything unexpected leaves no prefetch, and the page fetches as usual.
  }
}

export function homePrefetchScript(config: HomePrefetchConfig): string {
  // `<` is escaped so no config value can close the script element.
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return (
    `<script>(${bootHomePrefetch.toString()})(${json},` +
    `{search:location.search,now:Date.now(),fetch:function(u){return fetch(u)},target:window})</script>`
  );
}

export type HomePrefetch = {
  profiles: Promise<PublicProfileOption[]>;
  overview: Promise<OverviewPayload | null>;
  insights: Promise<InsightsPayload | null>;
  band: Promise<HomeBand>;
};

type PayloadRow<T> = Array<{ payload: T }>;

/** Hands over the boot script's requests once. Null when there are none (a
    client-side navigation) or they were made for another slug or range. */
export function takeHomePrefetch(
  target: Record<string, unknown>,
  slug: string,
  range: { start: string; end: string }
): HomePrefetch | null {
  const raw = target[GLOBAL_KEY] as RawPrefetch | undefined;
  delete target[GLOBAL_KEY];
  if (!raw || raw.slug !== slug || raw.start !== range.start || raw.end !== range.end) return null;

  return {
    profiles: handled(raw.profiles.then((rows) => (rows ?? []) as PublicProfileOption[])),
    overview: handled(raw.overview.then((rows) => (rows as PayloadRow<OverviewPayload>)[0]?.payload ?? null)),
    insights: handled(raw.insights.then((rows) => (rows as PayloadRow<InsightsPayload>)[0]?.payload ?? null)),
    band: handled(raw.band.then(parseHomeBand))
  };
}

// As in the boot script: a failure surfaces where the page awaits the promise,
// and is not reported as unhandled if the page never does.
function handled<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}
