import { describe, expect, it } from 'vitest';
import { orderUnenrichedByRecency } from '../../scripts/enrich-backfill.js';
import { remainingSpotifyCooldownSeconds } from '../../supabase/functions/_shared/spotify-enrichment-cooldown.ts';

describe('orderUnenrichedByRecency', () => {
  const unenriched = new Map([
    [1, { id: 1, spotify_track_id: 'a' }],
    [2, { id: 2, spotify_track_id: 'b' }],
    [3, { id: 3, spotify_track_id: 'c' }]
  ]);

  it('orders by first (most recent) appearance and dedupes', () => {
    const eventsDesc = [
      { track_id: 2 },
      { track_id: 1 },
      { track_id: 2 }, // older repeat ignored
      { track_id: 3 }
    ];
    expect(orderUnenrichedByRecency(eventsDesc, unenriched).map((t) => t.id)).toEqual([2, 1, 3]);
  });

  it('skips tracks not in the unenriched set and null track ids', () => {
    const eventsDesc = [{ track_id: 99 }, { track_id: null }, { track_id: 3 }, { track_id: 1 }];
    expect(orderUnenrichedByRecency(eventsDesc, unenriched).map((t) => t.id)).toEqual([3, 1]);
  });
});

describe('remainingSpotifyCooldownSeconds', () => {
  it('reconstructs the app-wide reset deadline from production telemetry', () => {
    expect(remainingSpotifyCooldownSeconds({
      aborted: true,
      started_at: '2026-08-29T15:45:04.283641Z',
      abort_retry_after_seconds: 42_316
    }, Date.parse('2026-08-29T16:00:04.507953Z'))).toBe(41_416);
  });

  it('preserves the same deadline when a skipped cron records the remaining delay', () => {
    const originalNow = Date.parse('2026-08-29T15:00:04.251981Z');
    const originalRemaining = remainingSpotifyCooldownSeconds({
      aborted: true,
      started_at: '2026-08-29T14:45:05.158472Z',
      abort_retry_after_seconds: 45_915
    }, originalNow);
    expect(originalRemaining).toBe(45_016);

    expect(remainingSpotifyCooldownSeconds({
      aborted: true,
      started_at: new Date(originalNow).toISOString(),
      abort_retry_after_seconds: originalRemaining
    }, Date.parse('2026-08-29T16:00:04.507953Z'))).toBe(41_416);
  });

  it('does not block expired, invalid, or non-aborted runs', () => {
    expect(remainingSpotifyCooldownSeconds({
      aborted: true,
      started_at: '2026-08-29T00:00:00Z',
      abort_retry_after_seconds: 60
    }, Date.parse('2026-08-29T00:02:00Z'))).toBe(0);
    expect(remainingSpotifyCooldownSeconds({
      aborted: false,
      started_at: '2026-08-29T00:00:00Z',
      abort_retry_after_seconds: 60
    })).toBe(0);
    expect(remainingSpotifyCooldownSeconds({
      aborted: true,
      started_at: 'not-a-date',
      abort_retry_after_seconds: 60
    })).toBe(0);
  });
});
