import { beforeEach, describe, expect, it, vi } from 'vitest';

const rowsByTable = new Map<string, Array<Record<string, unknown>>>();
const errorsByTable = new Map<string, string>();
const queryCalls: Array<{ table: string; column: string; values: unknown[] }> = [];

class FakeQuery {
  private filter: { column: string; values: unknown[] } | null = null;

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filter = { column, values };
    queryCalls.push({ table: this.table, column, values });
    return this;
  }

  returns<T>() {
    const error = errorsByTable.get(this.table);
    if (error) return Promise.resolve({ data: null, error: { message: error } });

    const rows = rowsByTable.get(this.table) ?? [];
    const data = this.filter
      ? rows.filter((row) => this.filter?.values.includes(row[this.filter.column]))
      : rows;
    return Promise.resolve({ data: data as T, error: null });
  }
}

vi.mock('$lib/supabase', () => ({
  supabase: {
    from: (table: string) => new FakeQuery(table)
  }
}));

describe('album artwork queries', () => {
  beforeEach(() => {
    rowsByTable.clear();
    errorsByTable.clear();
    queryCalls.length = 0;
  });

  it('deduplicates valid internal album ids and maps nullable artwork', async () => {
    const { fetchAlbumImages } = await import('../../src/lib/queries/images.js');
    rowsByTable.set('albums', [
      { id: 1, name: 'In Rainbows', image_url: 'https://example.com/in-rainbows.jpg', spotify_url: null },
      { id: 2, name: 'No Art', image_url: null, spotify_url: 'https://open.spotify.com/album/2' }
    ]);

    const images = await fetchAlbumImages([1, 1, 2, null, undefined, Number.NaN, -1, 2.5]);

    expect(queryCalls).toEqual([{ table: 'albums', column: 'id', values: [1, 2] }]);
    expect(images.get(1)).toEqual({
      name: 'In Rainbows',
      image_url: 'https://example.com/in-rainbows.jpg',
      spotify_url: null
    });
    expect(images.get(2)).toEqual({
      name: 'No Art',
      image_url: null,
      spotify_url: 'https://open.spotify.com/album/2'
    });
  });

  it('resolves a track through its album without duplicating metadata queries', async () => {
    const { fetchTrackAlbumImages } = await import('../../src/lib/queries/images.js');
    rowsByTable.set('tracks', [
      { id: 10, album_id: 1 },
      { id: 11, album_id: 1 },
      { id: 12, album_id: null }
    ]);
    rowsByTable.set('albums', [
      { id: 1, name: 'In Rainbows', image_url: 'https://example.com/in-rainbows.jpg', spotify_url: null }
    ]);

    const images = await fetchTrackAlbumImages([10, 11, 12]);

    expect(queryCalls).toEqual([
      { table: 'tracks', column: 'id', values: [10, 11, 12] },
      { table: 'albums', column: 'id', values: [1] }
    ]);
    expect(images.get(10)).toEqual({
      album_id: 1,
      name: 'In Rainbows',
      image_url: 'https://example.com/in-rainbows.jpg',
      spotify_url: null
    });
    expect(images.get(11)).toEqual(images.get(10));
    expect(images.has(12)).toBe(false);
  });

  it('keeps Supabase metadata errors visible to callers', async () => {
    const { fetchAlbumImages } = await import('../../src/lib/queries/images.js');
    errorsByTable.set('albums', 'permission denied');

    await expect(fetchAlbumImages([1])).rejects.toThrow('permission denied');
  });
});
