const LASTFM_API_ROOT = 'https://ws.audioscrobbler.com/2.0/';

export type LastFmCapture = {
  method: string;
  params: Record<string, string | number>;
  fetched_at: string;
  http_status: number | null;
  ok: boolean;
  data: unknown | null;
  error: {
    code: number | null;
    message: string;
  } | null;
};

function apiError(payload: unknown): { code: number | null; message: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as { error?: unknown; message?: unknown };
  if (value.error === undefined) return null;
  return {
    code: typeof value.error === 'number' ? value.error : null,
    message: typeof value.message === 'string' ? value.message : 'Unknown Last.fm API error'
  };
}

export async function captureLastFm(
  apiKey: string,
  method: string,
  params: Record<string, string | number>,
  fetchImpl: typeof fetch = fetch
): Promise<LastFmCapture> {
  const fetchedAt = new Date().toISOString();
  const url = new URL(LASTFM_API_ROOT);
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    const body = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return {
        method,
        params,
        fetched_at: fetchedAt,
        http_status: response.status,
        ok: false,
        data: null,
        error: { code: null, message: 'Last.fm returned invalid JSON' }
      };
    }

    const error = apiError(data);
    return {
      method,
      params,
      fetched_at: fetchedAt,
      http_status: response.status,
      ok: response.ok && error === null,
      data,
      error: error ?? (response.ok ? null : { code: null, message: `Last.fm returned HTTP ${response.status}` })
    };
  } catch (error) {
    return {
      method,
      params,
      fetched_at: fetchedAt,
      http_status: null,
      ok: false,
      data: null,
      error: {
        code: null,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export function topTagNames(captures: LastFmCapture[]): string[] {
  const names: string[] = [];
  for (const capture of captures) {
    const data = capture.data as { toptags?: { tag?: unknown } } | null;
    const tags = data?.toptags?.tag;
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      if (!tag || typeof tag !== 'object') continue;
      const name = (tag as { name?: unknown }).name;
      if (typeof name === 'string' && name.trim()) names.push(name.trim());
    }
  }
  return names;
}
