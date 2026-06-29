import { describe, expect, it } from 'vitest';
import { orderUnenrichedByRecency } from '../../scripts/enrich-backfill.js';

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
