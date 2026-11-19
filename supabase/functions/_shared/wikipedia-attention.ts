// Runtime-neutral Wikipedia page-view fetcher shared by the
// refresh-wikipedia-attention Edge Function and scripts/wikipedia-attention.ts.
// The database owns the work lists and the multiplier formula
// (migration 20261109120000_wikipedia_attention.sql); this module only links
// artists to articles, finds former titles and fetches monthly views.

// The Edge runtime resolves `npm:` specifiers; Node erases this type-only
// import before execution.
// @ts-expect-error Deno-specific npm specifier.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** Wikimedia asks every client to identify itself with a contact. */
export const WIKIMEDIA_USER_AGENT =
  'musik/1.0 (https://github.com/kartikey-vyas/spotify-tracker; monthly artist page views)';
/** The first month the Pageviews API has. */
export const PAGEVIEWS_START = '2015-07-01';
/** Sequential calls at this gap ran without throttling; 8 in parallel did not. */
export const WIKIMEDIA_DELAY_MS = 750;

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const ENWIKI_API = 'https://en.wikipedia.org/w/api.php';
const PAGEVIEWS_API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews';
const SPARQL_BATCH = 200;
const MEDIAWIKI_BATCH = 50;
const MAX_RETRY_WAIT_MS = 30_000;

// ---- Months. Every month is a 'YYYY-MM-01' string in UTC. ----

export function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function addMonths(month: string, count: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return monthOf(new Date(Date.UTC(year, monthNumber - 1 + count, 1)));
}

/** The newest month that has ended at `now`. */
export function lastCompleteMonth(now: Date): string {
  return addMonths(monthOf(now), -1);
}

/** Inclusive; empty when `from` is after `through`. */
export function monthRange(from: string, through: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= through; month = addMonths(month, 1)) months.push(month);
  return months;
}

/** 'YYYYMMDD00' for the first day (start) or last day (end) of the month. */
export function pageviewTimestamp(month: string, edge: 'start' | 'end'): string {
  const day = edge === 'start' ? month : new Date(Date.parse(`${addMonths(month, 1)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `${day.replaceAll('-', '')}00`;
}

export type MonthViews = { month: string; views: number };

/** Pageviews API items to months. The timestamp is 'YYYYMMDDHH'. */
export function parsePageviewItems(body: unknown): MonthViews[] {
  const items = (body as { items?: Array<{ timestamp?: string; views?: number }> } | null)?.items ?? [];
  return items
    .filter((item) => typeof item.timestamp === 'string' && typeof item.views === 'number')
    .map((item) => ({
      month: `${item.timestamp!.slice(0, 4)}-${item.timestamp!.slice(4, 6)}-01`,
      views: item.views!
    }));
}

/**
 * Sums several titles' months into one consecutive series from `from` to
 * `through`, with zeros for missing months. With `trimLeading`, the series
 * starts at the first month any title has data, and is empty when none has.
 */
export function buildMonthlySeries(
  perTitle: MonthViews[][],
  from: string,
  through: string,
  trimLeading: boolean
): { from: string | null; views: number[] } {
  const totals = new Map<string, number>();
  for (const series of perTitle) {
    for (const { month, views } of series) {
      if (month < from || month > through) continue;
      totals.set(month, (totals.get(month) ?? 0) + views);
    }
  }
  let start = from;
  if (trimLeading) {
    if (totals.size === 0) return { from: null, views: [] };
    start = [...totals.keys()].sort()[0];
  }
  const months = monthRange(start, through);
  return { from: months.length > 0 ? start : null, views: months.map((month) => totals.get(month) ?? 0) };
}

// ---- Matching. ----

export type WikidataBinding = { spotifyId: string; qid: string; title: string | null };

/**
 * One Wikidata item per Spotify ID: an item with an English article first,
 * then the oldest item (lowest Q number). Spotify IDs with no item are absent.
 */
export function pickWikidataMatches(bindings: WikidataBinding[]): Map<string, { qid: string; title: string | null }> {
  const qNumber = (qid: string): number => Number(qid.replace(/^Q/, '')) || Number.MAX_SAFE_INTEGER;
  const picked = new Map<string, { qid: string; title: string | null }>();
  for (const binding of bindings) {
    const current = picked.get(binding.spotifyId);
    const better =
      !current ||
      (binding.title !== null && current.title === null) ||
      ((binding.title === null) === (current.title === null) && qNumber(binding.qid) < qNumber(current.qid));
    if (better) picked.set(binding.spotifyId, { qid: binding.qid, title: binding.title });
  }
  return picked;
}

/**
 * A title reduced to the name it carries: no trailing "(…)" qualifier, no
 * accents, case or punctuation. "Drake (rapper)" and "Drake (musician)" both
 * give "drake".
 */
export function subjectKey(title: string): string {
  return title
    .replace(/\s*\([^)]*\)\s*$/, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * True when a redirect names the same artist as its article. Former titles
 * from page moves pass ("SZA (singer)" to "SZA"), as do spellings people
 * search for ("Tyler the Creator"). Redirects from merged album, tour or
 * discography pages fail, because their old views were for another page.
 */
export function isSameSubjectTitle(redirect: string, article: string): boolean {
  const key = subjectKey(article);
  return redirect !== article && key !== '' && subjectKey(redirect) === key;
}

/** Retry-After in milliseconds, as seconds or an HTTP date; null when absent. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

// ---- HTTP. ----

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serial Wikimedia client: one call at a time, paced, retrying 429 and 5xx. */
export class WikimediaClient {
  private nextAt = 0;
  calls = 0;
  throttled = 0;

  constructor(
    private readonly userAgent = WIKIMEDIA_USER_AGENT,
    private readonly delayMs = WIKIMEDIA_DELAY_MS
  ) {}

  /** The parsed body, or null on 404. */
  async getJson(url: string, init: RequestInit = {}): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      const wait = this.nextAt - Date.now();
      if (wait > 0) await sleep(wait);
      this.nextAt = Date.now() + this.delayMs;
      this.calls += 1;

      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          headers: {
            'User-Agent': this.userAgent,
            'Api-User-Agent': this.userAgent,
            Accept: 'application/json',
            ...(init.headers as Record<string, string> | undefined)
          }
        });
      } catch (error) {
        if (attempt >= 4) throw error;
        await sleep(2000 * attempt);
        continue;
      }

      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (response.status === 429 || response.status >= 500) {
        this.throttled += response.status === 429 ? 1 : 0;
        const delay = Math.min(retryAfterMs(response.headers.get('retry-after')) ?? 5000 * attempt, MAX_RETRY_WAIT_MS);
        await response.body?.cancel();
        if (attempt >= 4) throw new Error(`${response.status} from ${new URL(url).host} after ${attempt} attempts`);
        await sleep(delay);
        continue;
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} from ${new URL(url).host}: ${text.slice(0, 200)}`);
      }
      return await response.json();
    }
  }

  async wikidataBySpotifyIds(spotifyIds: string[]): Promise<WikidataBinding[]> {
    const values = spotifyIds.map((id) => `"${id.replace(/[^A-Za-z0-9]/g, '')}"`).join(' ');
    const query = `SELECT ?sid ?item ?title WHERE {
      VALUES ?sid { ${values} }
      ?item wdt:P1902 ?sid .
      OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title . }
    }`;
    const body = (await this.getJson(WIKIDATA_SPARQL, {
      method: 'POST',
      body: new URLSearchParams({ query }),
      headers: { Accept: 'application/sparql-results+json' }
    })) as { results?: { bindings?: Array<Record<string, { value: string }>> } } | null;
    return (body?.results?.bindings ?? []).map((row) => ({
      spotifyId: row.sid.value,
      qid: row.item.value.replace(/^.*\//, ''),
      title: row.title?.value ?? null
    }));
  }

  private async mediawiki(params: Record<string, string>): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', maxlag: '5', ...params });
    const body = (await this.getJson(`${ENWIKI_API}?${query}`)) as Record<string, unknown> | null;
    if (!body) throw new Error('Empty MediaWiki response');
    if (body.error) throw new Error(`MediaWiki error: ${JSON.stringify(body.error).slice(0, 200)}`);
    return body;
  }

  /**
   * Redirects that name the same artist as each article. Their views count
   * for the article: a page move leaves the old history under the old title,
   * and later visits through a redirect are counted under the redirect.
   */
  async formerTitles(titles: string[]): Promise<Map<string, string[]>> {
    const redirects = new Map<string, string[]>(titles.map((title) => [title, []]));
    let params: Record<string, string> = {
      prop: 'redirects',
      titles: titles.join('|'),
      rdlimit: 'max',
      rdnamespace: '0'
    };
    for (;;) {
      const body = await this.mediawiki(params);
      const query = body.query as {
        normalized?: Array<{ from: string; to: string }>;
        pages?: Array<{ title: string; redirects?: Array<{ title: string }> }>;
      };
      const original = new Map((query.normalized ?? []).map((n) => [n.to, n.from]));
      for (const page of query.pages ?? []) {
        const key = original.get(page.title) ?? page.title;
        for (const redirect of page.redirects ?? []) redirects.get(key)?.push(redirect.title);
      }
      if (!body.continue) break;
      params = { ...params, ...(body.continue as Record<string, string>) };
    }

    const result = new Map<string, string[]>();
    for (const [title, list] of redirects) {
      result.set(title, [...new Set(list.filter((redirect) => isSameSubjectTitle(redirect, title)))].sort());
    }
    return result;
  }

  async articleMonthlyViews(title: string, from: string, through: string): Promise<MonthViews[]> {
    const article = encodeURIComponent(title.replaceAll(' ', '_'));
    const url = `${PAGEVIEWS_API}/per-article/en.wikipedia/all-access/user/${article}/monthly/${pageviewTimestamp(from, 'start')}/${pageviewTimestamp(through, 'end')}`;
    return parsePageviewItems(await this.getJson(url));
  }

  async siteMonthlyViews(from: string, through: string): Promise<MonthViews[]> {
    const url = `${PAGEVIEWS_API}/aggregate/en.wikipedia/all-access/user/monthly/${pageviewTimestamp(from, 'start')}/${pageviewTimestamp(through, 'end')}`;
    return parsePageviewItems(await this.getJson(url));
  }
}

// ---- One batch. ----

export type WikipediaBatchCounts = {
  site_through: string | null;
  artists_linked: number;
  articles_checked_for_moves: number;
  articles_fetched: number;
  multipliers_refreshed: number | null;
  wikimedia_calls: number;
  throttled: number;
  stopped_for_time: boolean;
};

type Candidate = { id: number; title: string; former_titles: string[]; views_from: string | null; views_through: string | null };

async function rpc<T>(supabase: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data as T;
}

/**
 * Brings the site totals up to the last complete month and returns the newest
 * month stored. Article views are only ever fetched up to that month, so a
 * month the API has not published yet is never saved as zeros.
 */
async function ensureSiteMonths(supabase: SupabaseClient, client: WikimediaClient, now: Date): Promise<string | null> {
  const target = lastCompleteMonth(now);
  const { data, error } = await supabase
    .from('wikipedia_site_monthly')
    .select('month')
    .order('month', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Reading wikipedia_site_monthly failed: ${error.message}`);
  const stored = (data as Array<{ month: string }> | null)?.[0]?.month ?? null;
  if (stored !== null && stored >= target) return stored;

  const months = await client.siteMonthlyViews(PAGEVIEWS_START, target);
  if (months.length > 0) await rpc(supabase, 'save_wikipedia_site_months', { p_rows: months });
  const newest = months.map((month) => month.month).sort().pop() ?? null;
  return newest && (!stored || newest > stored) ? newest : stored;
}

export async function runWikipediaAttentionBatch(
  supabase: SupabaseClient,
  client: WikimediaClient,
  options: { deadline: number; now?: Date; linkLimit?: number; redirectLimit?: number; pageviewLimit?: number }
): Promise<WikipediaBatchCounts> {
  const now = options.now ?? new Date();
  const timeLeft = () => options.deadline - Date.now();
  const counts: WikipediaBatchCounts = {
    site_through: null,
    artists_linked: 0,
    articles_checked_for_moves: 0,
    articles_fetched: 0,
    multipliers_refreshed: null,
    wikimedia_calls: 0,
    throttled: 0,
    stopped_for_time: false
  };
  const finish = () => {
    counts.wikimedia_calls = client.calls;
    counts.throttled = client.throttled;
    return counts;
  };

  const through = await ensureSiteMonths(supabase, client, now);
  counts.site_through = through;
  if (!through) return finish();

  // 1. Link played artists to articles.
  const toLink = await rpc<Array<{ artist_id: number; spotify_artist_id: string }>>(supabase, 'wikipedia_link_candidates', {
    p_limit: options.linkLimit ?? 400
  });
  for (let i = 0; i < toLink.length; i += SPARQL_BATCH) {
    if (timeLeft() < 20_000) return { ...finish(), stopped_for_time: true };
    const chunk = toLink.slice(i, i + SPARQL_BATCH);
    const matches = pickWikidataMatches(await client.wikidataBySpotifyIds(chunk.map((row) => row.spotify_artist_id)));
    const links = chunk.map((row) => {
      const match = matches.get(row.spotify_artist_id);
      return { artist_id: row.artist_id, qid: match?.qid ?? null, title: match?.title ?? null };
    });
    counts.artists_linked += await rpc<number>(supabase, 'save_wikipedia_links', { p_links: links });
  }

  // 2. Same-artist redirects, before any views are fetched for an article.
  const toCheck = await rpc<Array<{ id: number; title: string }>>(supabase, 'wikipedia_redirect_candidates', {
    p_limit: options.redirectLimit ?? 200
  });
  for (let i = 0; i < toCheck.length; i += MEDIAWIKI_BATCH) {
    if (timeLeft() < 20_000) return { ...finish(), stopped_for_time: true };
    const chunk = toCheck.slice(i, i + MEDIAWIKI_BATCH);
    const former = await client.formerTitles(chunk.map((row) => row.title));
    const updates = chunk.map((row) => ({ id: row.id, former_titles: former.get(row.title) ?? [] }));
    counts.articles_checked_for_moves += await rpc<number>(supabase, 'save_wikipedia_former_titles', { p_updates: updates });
  }

  // 3. Monthly views: the full history for new articles, new months otherwise.
  const toFetch = await rpc<Candidate[]>(supabase, 'wikipedia_pageview_candidates', {
    p_through: through,
    p_limit: options.pageviewLimit ?? 500
  });
  for (const article of toFetch) {
    const titles = [article.title, ...article.former_titles];
    if (timeLeft() < titles.length * 3_000 + 5_000) return { ...finish(), stopped_for_time: true };
    const append = article.views_from !== null && article.views_through !== null;
    const from = append ? addMonths(article.views_through!, 1) : PAGEVIEWS_START;
    const perTitle: MonthViews[][] = [];
    for (const title of titles) perTitle.push(await client.articleMonthlyViews(title, from, through));
    const series = buildMonthlySeries(perTitle, from, through, !append);
    await rpc(supabase, 'save_wikipedia_pageviews', {
      p_article_id: article.id,
      p_from: series.from ?? from,
      p_views: series.views,
      p_through: through,
      p_append: append
    });
    counts.articles_fetched += 1;
  }

  // 4. Recompute the multipliers once nothing is left to fetch and some are
  //    out of date. The insights cache picks them up on its daily run.
  const progress = await rpc<Record<string, number | string | null>>(supabase, 'wikipedia_attention_progress');
  if (
    progress.articles_to_check_redirects === 0 &&
    progress.articles_to_fetch === 0 &&
    Number(progress.articles_with_stale_multipliers ?? 0) > 0
  ) {
    counts.multipliers_refreshed = await rpc<number>(supabase, 'refresh_wikipedia_attention');
  }
  return finish();
}
