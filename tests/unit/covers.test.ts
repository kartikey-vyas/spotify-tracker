import { describe, expect, it } from 'vitest';
import { coverVariant, type CoverSize } from '../../src/lib/covers';

const HASH = 'ff9ca10b';
const urlFor = (prefix: string) => `https://i.scdn.co/image/${prefix}${HASH}`;
const PREFIXES: Record<CoverSize, string> = {
  large: 'ab67616d0000b273',
  medium: 'ab67616d00001e02',
  small: 'ab67616d00004851'
};
const SIZES = Object.keys(PREFIXES) as CoverSize[];

describe('coverVariant', () => {
  it('converts between every pair of Spotify cover sizes', () => {
    for (const from of SIZES) {
      for (const to of SIZES) {
        expect(coverVariant(urlFor(PREFIXES[from]), to)).toBe(urlFor(PREFIXES[to]));
      }
    }
  });

  it('leaves urls in other formats untouched', () => {
    // An artist image (different prefix family) and a non-Spotify host.
    const artistImage = 'https://i.scdn.co/image/ab6742d3000053b7fe9e653c9d1d3c5d';
    expect(coverVariant(artistImage, 'medium')).toBe(artistImage);
    expect(coverVariant('https://example.com/cover.jpg', 'small')).toBe('https://example.com/cover.jpg');
  });
});
