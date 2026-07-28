import { describe, expect, it } from 'vitest';
import { parseArtistPresence } from '../../src/lib/pixel-person/artist-presence';

const rect = { x: 10, y: 20, width: 30, height: 40 };

describe('parseArtistPresence', () => {
  it('returns null when the element carries no artist attribute', () => {
    expect(parseArtistPresence(rect, 'el-1', null, null)).toBeNull();
  });

  it('returns null for a blank artist name', () => {
    expect(parseArtistPresence(rect, 'el-1', '   ', null)).toBeNull();
  });

  it('carries the rect, id and trimmed name through', () => {
    expect(parseArtistPresence(rect, 'el-1', ' Frank Ocean ', null)).toEqual({
      ...rect,
      id: 'el-1',
      name: 'Frank Ocean',
      rank: undefined
    });
  });

  it('parses a positive integer rank', () => {
    expect(parseArtistPresence(rect, 'el-1', 'Frank Ocean', '3')?.rank).toBe(3);
  });

  it('ignores ranks that are not positive integers', () => {
    expect(parseArtistPresence(rect, 'el-1', 'Frank Ocean', '0')?.rank).toBeUndefined();
    expect(parseArtistPresence(rect, 'el-1', 'Frank Ocean', '-2')?.rank).toBeUndefined();
    expect(parseArtistPresence(rect, 'el-1', 'Frank Ocean', 'abc')?.rank).toBeUndefined();
    expect(parseArtistPresence(rect, 'el-1', 'Frank Ocean', '1.5')?.rank).toBeUndefined();
  });
});
