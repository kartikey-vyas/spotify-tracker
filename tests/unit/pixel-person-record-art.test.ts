import { describe, expect, it, vi } from 'vitest';
import {
  clearRecordArtCache,
  requestRecordArt,
  smallCoverVariant
} from '../../src/lib/pixel-person/record-art';

describe('record artwork URLs', () => {
  it('rewrites the stored 640px cover hash to the 64px variant', () => {
    expect(smallCoverVariant('https://i.scdn.co/image/ab67616d0000b273ff9ca10b')).toBe(
      'https://i.scdn.co/image/ab67616d00004851ff9ca10b'
    );
  });

  it('rewrites the 300px cover-wall variant to the 64px one too', () => {
    expect(smallCoverVariant('https://i.scdn.co/image/ab67616d00001e02ff9ca10b')).toBe(
      'https://i.scdn.co/image/ab67616d00004851ff9ca10b'
    );
  });

  it('leaves unknown urls untouched', () => {
    expect(smallCoverVariant('https://example.com/cover.jpg')).toBe(
      'https://example.com/cover.jpg'
    );
  });
});

describe('record art failure retry', () => {
  it('retries a failed fetch after the backoff instead of poisoning the source', async () => {
    clearRecordArtCache();
    const failingFetch = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', failingFetch);

    const entry = requestRecordArt('https://example.com/cover.jpg');
    await vi.waitFor(() => expect(entry.status).toBe('failed'));
    expect(entry.failedAt).toBeDefined();
    const fetchesAfterFailure = failingFetch.mock.calls.length;

    // Within the backoff: no new fetch.
    requestRecordArt('https://example.com/cover.jpg');
    expect(failingFetch.mock.calls.length).toBe(fetchesAfterFailure);

    // Past the backoff: retried.
    entry.failedAt = Date.now() - 61_000;
    const retried = requestRecordArt('https://example.com/cover.jpg');
    expect(retried.status).toBe('loading');
    await vi.waitFor(() =>
      expect(failingFetch.mock.calls.length).toBeGreaterThan(fetchesAfterFailure)
    );
    clearRecordArtCache();
  });
});
