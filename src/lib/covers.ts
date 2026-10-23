/* Spotify album art comes in three sizes that share one image hash and differ
   only in a size prefix. albums.image_url stores the 640px one (~90 KB), which
   is far more than a cover-wall tile needs: tiles are 96-150px wide, so the
   300px version (~30 KB) is still sharp at 2x. URLs that are not in this
   format (other hosts, artist images) come back unchanged. */

const SIZE_PREFIXES = {
  large: 'ab67616d0000b273', // 640px
  medium: 'ab67616d00001e02', // 300px
  small: 'ab67616d00004851' // 64px
} as const;

export type CoverSize = keyof typeof SIZE_PREFIXES;

const ANY_SIZE_PREFIX = new RegExp(Object.values(SIZE_PREFIXES).join('|'));

export function coverVariant(url: string, size: CoverSize): string {
  return url.replace(ANY_SIZE_PREFIX, SIZE_PREFIXES[size]);
}
