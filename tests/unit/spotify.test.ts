import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAlbums, getArtists, getTracks } from '../../scripts/lib/spotify.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The batch "Get Several X" endpoints (/v1/artists?ids=, /v1/tracks?ids=, /v1/albums?ids=)
 * were removed from the Spotify Web API in February 2026. Only the single-item endpoints
 * (/v1/artists/{id}, ...) remain available. These tests pin the fetchers to the single-item
 * form and to per-id resilience.
 */
describe('Spotify catalog fetchers use single-item endpoints', () => {
  it('getArtists fetches each id via /v1/artists/{id} and aggregates in order', async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        paths.push(path);
        const id = path.split('/').pop();
        return new Response(JSON.stringify({ id, name: `Artist ${id}` }), { status: 200 });
      })
    );

    const artists = await getArtists('token', ['a1', 'a2', 'a3']);

    expect(paths).toEqual(['/v1/artists/a1', '/v1/artists/a2', '/v1/artists/a3']);
    expect(artists.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('getTracks fetches each id via /v1/tracks/{id} and aggregates', async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        paths.push(path);
        const id = path.split('/').pop();
        return new Response(JSON.stringify({ id, name: `Track ${id}` }), { status: 200 });
      })
    );

    const tracks = await getTracks('token', ['t1', 't2']);

    expect(paths).toEqual(['/v1/tracks/t1', '/v1/tracks/t2']);
    expect(tracks.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('getAlbums fetches each id via /v1/albums/{id} and aggregates', async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        paths.push(path);
        const id = path.split('/').pop();
        return new Response(JSON.stringify({ id, name: `Album ${id}` }), { status: 200 });
      })
    );

    const albums = await getAlbums('token', ['al1', 'al2']);

    expect(paths).toEqual(['/v1/albums/al1', '/v1/albums/al2']);
    expect(albums.map((a) => a.id)).toEqual(['al1', 'al2']);
  });

  it('getArtists skips ids that return 404 and keeps the rest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const id = new URL(url).pathname.split('/').pop();
        if (id === 'missing') {
          return new Response(JSON.stringify({ error: { status: 404, message: 'Not found' } }), {
            status: 404
          });
        }
        return new Response(JSON.stringify({ id, name: `Artist ${id}` }), { status: 200 });
      })
    );

    const artists = await getArtists('token', ['a1', 'missing', 'a2']);

    expect(artists.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('returns empty array without fetching when given no ids', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await getArtists('token', [])).toEqual([]);
    expect(await getTracks('token', [])).toEqual([]);
    expect(await getAlbums('token', [])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
