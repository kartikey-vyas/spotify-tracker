import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeRollupRow = {
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

class FakeQuery {
  private filters = new Map<string, unknown>();
  private start: number | null = null;
  private end: number | null = null;
  private limitCount: number | null = null;

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

  order() {
    return this;
  }

  range(start: number, end: number) {
    this.start = start;
    this.end = end;
    return this;
  }

  returns<T>() {
    const rows = rowsByTable.get(this.table) ?? [];
    const entityType = this.filters.get('entity_type');
    const startDate = this.filters.get('local_date:gte');
    const endDate = this.filters.get('local_date:lte');
    const filtered = rows.filter(
      (row) =>
        (!entityType || row.entity_type === entityType) &&
        (!startDate || row.local_date >= String(startDate)) &&
        (!endDate || row.local_date <= String(endDate))
    );

    const start = this.start ?? 0;
    const end = this.end ?? (this.limitCount === null ? filtered.length - 1 : this.limitCount - 1);
    return Promise.resolve({ data: filtered.slice(start, end + 1), error: null }) as Promise<{
      data: T;
      error: null;
    }>;
  }
}

vi.mock('$lib/supabase', () => ({
  supabase: {
    from: (table: string) => new FakeQuery(table)
  }
}));

describe('getRankings', () => {
  beforeEach(() => {
    rowsByTable.clear();
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
});
