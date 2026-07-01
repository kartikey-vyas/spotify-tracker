import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeRollupRow = {
  slug?: string;
  local_date: string;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  minutes_exact: number;
  minutes_inferred: number;
  plays: number;
  qualified_plays: number;
  unique_tracks: number;
  skipped_count: number | null;
  known_skip_count: number | null;
  unknown_duration_plays: number;
};

const rowsByTable = new Map<string, FakeRollupRow[]>();
const rpcRowsByName = new Map<string, unknown[]>();
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

class FakeQuery {
  private filters = new Map<string, unknown>();
  private start: number | null = null;
  private end: number | null = null;
  private limitCount: number | null = null;
  private orders: Array<{ column: string; ascending: boolean }> = [];

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.set(column, value);
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.set(`${column}:gte`, value);
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.set(`${column}:lte`, value);
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  range(start: number, end: number) {
    this.start = start;
    this.end = end;
    return this;
  }

  returns<T>() {
    const rows = rowsByTable.get(this.table) ?? [];
    const filtered = rows.filter((row) => {
      for (const [key, value] of this.filters) {
        if (key.endsWith(':gte')) {
          const column = key.slice(0, -4) as keyof FakeRollupRow;
          if (String(row[column]) < String(value)) return false;
          continue;
        }
        if (key.endsWith(':lte')) {
          const column = key.slice(0, -4) as keyof FakeRollupRow;
          if (String(row[column]) > String(value)) return false;
          continue;
        }
        if (row[key as keyof FakeRollupRow] !== value) return false;
      }
      return true;
    });

    const ordered = [...filtered].sort((left, right) => {
      for (const order of this.orders) {
        const leftValue = String(left[order.column as keyof FakeRollupRow]);
        const rightValue = String(right[order.column as keyof FakeRollupRow]);
        const comparison = leftValue.localeCompare(rightValue);
        if (comparison !== 0) return order.ascending ? comparison : -comparison;
      }
      return 0;
    });

    const start = this.start ?? 0;
    const end = this.end ?? (this.limitCount === null ? ordered.length - 1 : this.limitCount - 1);
    return Promise.resolve({ data: ordered.slice(start, end + 1), error: null }) as Promise<{
      data: T;
      error: null;
    }>;
  }
}

vi.mock('$lib/supabase', () => ({
  supabase: {
    from: (table: string) => new FakeQuery(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return {
        returns<T>() {
          return Promise.resolve({ data: (rpcRowsByName.get(name) ?? []) as T, error: null });
        }
      };
    }
  }
}));

describe('getRankings', () => {
  beforeEach(() => {
    rowsByTable.clear();
    rpcRowsByName.clear();
    rpcCalls.length = 0;
  });

  it('aggregates rows beyond the first Supabase page for long date ranges', async () => {
    const { getRankings } = await import('../../src/lib/queries/rankings.js');
    const rows = Array.from({ length: 5000 }, (_, index) => ({
      local_date: '2026-06-01',
      entity_type: 'artist',
      entity_id: `artist-${index}`,
      entity_name: `Artist ${index}`,
      minutes_exact: 0,
      minutes_inferred: 0,
      plays: 1,
      qualified_plays: 0,
      unique_tracks: 1,
      skipped_count: null,
      known_skip_count: null,
      unknown_duration_plays: 1
    }));
    rows.push({
      local_date: '2026-06-02',
      entity_type: 'artist',
      entity_id: 'radiohead',
      entity_name: 'Radiohead',
      minutes_exact: 0,
      minutes_inferred: 0,
      plays: 34,
      qualified_plays: 0,
      unique_tracks: 10,
      skipped_count: null,
      known_skip_count: null,
      unknown_duration_plays: 34
    });
    rowsByTable.set('rollup_daily_entity_stats', rows);

    const rankings = await getRankings({
      entityType: 'artist',
      start: '2025-07-03',
      end: '2026-07-01',
      metric: 'plays',
      limit: 1
    });

    expect(rankings).toEqual([
      expect.objectContaining({
        entity_id: 'radiohead',
        entity_name: 'Radiohead',
        plays: 34
      })
    ]);
  });

  it('filters public profile rankings by slug', async () => {
    const { getProfileRankings } = await import('../../src/lib/queries/rankings.js');
    rowsByTable.set('public_profile_rollup_daily_entity_stats', [
      {
        slug: 'kartikey',
        local_date: '2026-06-01',
        entity_type: 'artist',
        entity_id: '1',
        entity_name: 'Radiohead',
        minutes_exact: 0,
        minutes_inferred: 0,
        plays: 5,
        qualified_plays: 0,
        unique_tracks: 2,
        skipped_count: null,
        known_skip_count: null,
        unknown_duration_plays: 5
      },
      {
        slug: 'friend',
        local_date: '2026-06-01',
        entity_type: 'artist',
        entity_id: '1',
        entity_name: 'Radiohead',
        minutes_exact: 0,
        minutes_inferred: 0,
        plays: 99,
        qualified_plays: 0,
        unique_tracks: 9,
        skipped_count: null,
        known_skip_count: null,
        unknown_duration_plays: 99
      }
    ]);

    const rankings = await getProfileRankings({
      slug: 'kartikey',
      entityType: 'artist',
      start: '2026-06-01',
      end: '2026-06-30',
      metric: 'plays',
      limit: 10
    });

    expect(rankings).toHaveLength(1);
    expect(rankings[0]).toEqual(expect.objectContaining({ entity_name: 'Radiohead', plays: 5 }));
  });

  it('resolves the first and last public rollup dates for a profile', async () => {
    const { getProfileDateSpan } = await import('../../src/lib/queries/rankings.js');
    rowsByTable.set('public_profile_rollup_daily_entity_stats', [
      {
        slug: 'kartikey',
        local_date: '2026-06-15',
        entity_type: 'artist',
        entity_id: '1',
        entity_name: 'Radiohead',
        minutes_exact: 0,
        minutes_inferred: 0,
        plays: 1,
        qualified_plays: 0,
        unique_tracks: 1,
        skipped_count: null,
        known_skip_count: null,
        unknown_duration_plays: 1
      },
      {
        slug: 'kartikey',
        local_date: '2026-01-03',
        entity_type: 'artist',
        entity_id: '2',
        entity_name: 'Nujabes',
        minutes_exact: 0,
        minutes_inferred: 0,
        plays: 1,
        qualified_plays: 0,
        unique_tracks: 1,
        skipped_count: null,
        known_skip_count: null,
        unknown_duration_plays: 1
      },
      {
        slug: 'friend',
        local_date: '2025-01-01',
        entity_type: 'artist',
        entity_id: '3',
        entity_name: 'Boris',
        minutes_exact: 0,
        minutes_inferred: 0,
        plays: 1,
        qualified_plays: 0,
        unique_tracks: 1,
        skipped_count: null,
        known_skip_count: null,
        unknown_duration_plays: 1
      }
    ]);

    await expect(getProfileDateSpan('kartikey')).resolves.toEqual({
      start: '2026-01-03',
      end: '2026-06-15'
    });
  });

  it('maps selected artist detail RPC rows into summary, albums, tracks, and monthly buckets', async () => {
    const { getProfileArtistDetail } = await import('../../src/lib/queries/rankings.js');
    rpcRowsByName.set('public_profile_artist_summary', [
      {
        entity_id: '10',
        entity_name: 'Radiohead',
        minutes: '42.5',
        plays: 12,
        qualified_plays: 9,
        unique_tracks: 4,
        skipped_count: 1,
        known_skip_count: 10,
        unknown_duration_plays: 2
      }
    ]);
    rpcRowsByName.set('public_profile_artist_top_albums', [
      {
        entity_id: '20',
        entity_name: 'In Rainbows',
        minutes: '30',
        plays: 8,
        qualified_plays: 7,
        unique_tracks: 3,
        skipped_count: 0,
        known_skip_count: 8,
        unknown_duration_plays: 1
      }
    ]);
    rpcRowsByName.set('public_profile_artist_top_tracks', [
      {
        entity_id: '30',
        entity_name: 'Reckoner',
        minutes: '9',
        plays: 3,
        qualified_plays: 3,
        unique_tracks: 1,
        skipped_count: 0,
        known_skip_count: 3,
        unknown_duration_plays: 0
      }
    ]);
    rpcRowsByName.set('public_profile_artist_monthly_timeline', [
      {
        month_start: '2026-06-01',
        minutes: '42.5',
        plays: 12,
        qualified_plays: 9,
        unique_tracks: 4,
        skipped_count: 1,
        known_skip_count: 10,
        unknown_duration_plays: 2
      }
    ]);

    await expect(
      getProfileArtistDetail({
        slug: 'kartikey',
        artistId: '10',
        start: '2026-06-01',
        end: '2026-06-30',
        metric: 'plays'
      })
    ).resolves.toEqual({
      summary: expect.objectContaining({ entity_id: '10', minutes: 42.5, plays: 12 }),
      albums: [expect.objectContaining({ entity_id: '20', minutes: 30, plays: 8 })],
      tracks: [expect.objectContaining({ entity_id: '30', minutes: 9, plays: 3 })],
      monthly: [
        {
          month_start: '2026-06-01',
          minutes: 42.5,
          plays: 12,
          qualified_plays: 9,
          unique_tracks: 4,
          skipped_count: 1,
          known_skip_count: 10,
          unknown_duration_plays: 2
        }
      ]
    });

    expect(rpcCalls.map((call) => call.name)).toEqual([
      'public_profile_artist_summary',
      'public_profile_artist_top_albums',
      'public_profile_artist_top_tracks',
      'public_profile_artist_monthly_timeline'
    ]);
    expect(rpcCalls[0].args).toEqual({
      p_slug: 'kartikey',
      p_artist_id: 10,
      p_start_date: '2026-06-01',
      p_end_date: '2026-06-30'
    });
    expect(rpcCalls[1].args).toEqual(expect.objectContaining({ p_sort_metric: 'plays', p_limit: 12 }));
  });
});
