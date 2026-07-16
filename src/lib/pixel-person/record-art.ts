/**
 * Turns album cover URLs into tiny pixel-art sprites for carried records.
 * This is the only pixel-person module that touches the network; the
 * simulation deals purely in URLs and the render layer polls entry status.
 *
 * Canvas-taint rule: only bitmaps from CORS-mode fetches are ever drawn, so
 * sprites from this cache can never taint the shared overlay canvas.
 */

export const RECORD_PIXELS = 12;
export const RECORD_SCALE = 2;

export type RecordArtStatus = 'loading' | 'ready' | 'failed';

export interface RecordArt {
  status: RecordArtStatus;
  sprite: HTMLCanvasElement | null;
}

const MAX_CACHED_RECORDS = 24;
const cache = new Map<string, RecordArt>();

// Spotify encodes the image size in the URL hash prefix; the stored URLs are
// the 640px variant, and this undocumented-but-stable rewrite fetches the
// 64px one (~2KB instead of ~40KB). The original URL stays as a fallback.
const FULL_SIZE_PREFIX = 'ab67616d0000b273';
const SMALL_SIZE_PREFIX = 'ab67616d00004851';

export function smallCoverVariant(url: string): string {
  return url.replace(FULL_SIZE_PREFIX, SMALL_SIZE_PREFIX);
}

/** Starts rasterizing the cover if unseen; idempotent, returns the live entry. */
export function requestRecordArt(imageUrl: string): RecordArt {
  const existing = cache.get(imageUrl);
  if (existing) {
    // Re-insert to mark as recently used.
    cache.delete(imageUrl);
    cache.set(imageUrl, existing);
    return existing;
  }
  const entry: RecordArt = { status: 'loading', sprite: null };
  cache.set(imageUrl, entry);
  evictLeastRecentlyUsed();
  void rasterize(imageUrl, entry);
  return entry;
}

/** Side-effect-free lookup for the render path. */
export function getRecordArt(imageUrl: string): RecordArt | undefined {
  return cache.get(imageUrl);
}

export function clearRecordArtCache(): void {
  cache.clear();
}

async function rasterize(imageUrl: string, entry: RecordArt): Promise<void> {
  const smallUrl = smallCoverVariant(imageUrl);
  const bitmap =
    (await fetchCoverBitmap(smallUrl)) ??
    (smallUrl !== imageUrl ? await fetchCoverBitmap(imageUrl) : null);
  if (!bitmap) {
    entry.status = 'failed';
    return;
  }

  const size = RECORD_PIXELS * RECORD_SCALE;
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const context = sprite.getContext('2d');
  if (!context) {
    bitmap.close();
    entry.status = 'failed';
    return;
  }
  context.imageSmoothingEnabled = false;
  if (bitmap.width === RECORD_PIXELS && bitmap.height === RECORD_PIXELS) {
    context.drawImage(bitmap, 0, 0, size, size);
  } else {
    // createImageBitmap resize options were ignored (older Safari): box-filter
    // down on an intermediate canvas, then nearest-neighbor up.
    const small = document.createElement('canvas');
    small.width = RECORD_PIXELS;
    small.height = RECORD_PIXELS;
    const smallContext = small.getContext('2d');
    if (!smallContext) {
      bitmap.close();
      entry.status = 'failed';
      return;
    }
    smallContext.imageSmoothingEnabled = true;
    smallContext.imageSmoothingQuality = 'high';
    smallContext.drawImage(bitmap, 0, 0, RECORD_PIXELS, RECORD_PIXELS);
    context.drawImage(small, 0, 0, size, size);
  }
  bitmap.close();
  entry.sprite = sprite;
  entry.status = 'ready';
}

async function fetchCoverBitmap(url: string): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;
    const blob = await response.blob();
    try {
      return await createImageBitmap(blob, {
        resizeWidth: RECORD_PIXELS,
        resizeHeight: RECORD_PIXELS,
        resizeQuality: 'high'
      });
    } catch {
      return await createImageBitmap(blob);
    }
  } catch {
    return null;
  }
}

function evictLeastRecentlyUsed(): void {
  if (cache.size <= MAX_CACHED_RECORDS) return;
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_CACHED_RECORDS) break;
    if (entry.status === 'loading') continue;
    cache.delete(key);
  }
}
