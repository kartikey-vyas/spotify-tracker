import { describe, expect, it, vi } from 'vitest';
import { captureLastFm, topTagNames } from '../../scripts/lib/lastfm.js';

describe('Last.fm capture', () => {
  it('sends the API key but never persists it in the capture', async () => {
    const calls: Array<Parameters<typeof fetch>> = [];
    const fetchMock: typeof fetch = async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify({ track: { name: 'Believe' } }));
    };

    const capture = await captureLastFm(
      'super-secret',
      'track.getInfo',
      { mbid: 'recording-id' },
      fetchMock
    );

    const requested = new URL(String(calls[0]![0]));
    expect(requested.searchParams.get('api_key')).toBe('super-secret');
    expect(requested.searchParams.get('method')).toBe('track.getInfo');
    expect(capture).toMatchObject({ method: 'track.getInfo', params: { mbid: 'recording-id' }, ok: true });
    expect(JSON.stringify(capture)).not.toContain('super-secret');
  });

  it('captures API errors returned with HTTP 200', async () => {
    const capture = await captureLastFm(
      'key',
      'track.getInfo',
      { mbid: 'missing' },
      vi.fn(async () => new Response(JSON.stringify({ error: 6, message: 'Track not found' })))
    );

    expect(capture).toMatchObject({ ok: false, error: { code: 6, message: 'Track not found' } });
  });

  it('extracts tag names from successful top-tag payloads', () => {
    const capture = {
      method: 'track.getTopTags',
      params: {},
      fetched_at: '2026-08-26T00:00:00.000Z',
      http_status: 200,
      ok: true,
      data: { toptags: { tag: [{ name: 'pop' }, { name: 'dance' }] } },
      error: null
    };

    expect(topTagNames([capture])).toEqual(['pop', 'dance']);
  });
});
