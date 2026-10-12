import { describe, expect, it } from 'vitest';
import { parseArtistPresence } from '../../src/lib/pixel-person/artist-presence';

describe('parseArtistPresence', () => {
  it('returns null when the element carries no artist attribute', () => {
    expect(parseArtistPresence(null, null)).toBeNull();
  });

  it('returns null for a blank artist name', () => {
    expect(parseArtistPresence('   ', null)).toBeNull();
  });

  it('carries the trimmed name through', () => {
    expect(parseArtistPresence(' Frank Ocean ', null)).toEqual({
      name: 'Frank Ocean',
      rank: undefined
    });
  });

  it('parses a positive integer rank', () => {
    expect(parseArtistPresence('Frank Ocean', '3')?.rank).toBe(3);
  });

  it('ignores ranks that are not positive integers', () => {
    expect(parseArtistPresence('Frank Ocean', '0')?.rank).toBeUndefined();
    expect(parseArtistPresence('Frank Ocean', '-2')?.rank).toBeUndefined();
    expect(parseArtistPresence('Frank Ocean', 'abc')?.rank).toBeUndefined();
    expect(parseArtistPresence('Frank Ocean', '1.5')?.rank).toBeUndefined();
  });
});
