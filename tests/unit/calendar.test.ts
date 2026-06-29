import { describe, expect, it } from 'vitest';
import { buildContributionGrid } from '../../src/lib/calendar.js';
import type { CalendarDay } from '../../src/lib/types.js';

const day = (local_date: string, plays: number, minutes = 0): CalendarDay => ({
  local_date,
  plays,
  minutes
});

describe('buildContributionGrid', () => {
  it('returns an empty grid for no data', () => {
    expect(buildContributionGrid([], 'plays')).toEqual({
      weeks: [],
      monthLabels: [],
      maxValue: 0,
      total: 0
    });
  });

  it('lays out Sunday-first weeks aligned to the end date', () => {
    // 2026-01-10 is a Saturday (dow 6), so a 2-week window starts 2025-12-28 (Sun).
    const grid = buildContributionGrid([day('2026-01-04', 2), day('2026-01-05', 10)], 'plays', {
      weeks: 2,
      endDate: '2026-01-10'
    });

    expect(grid.weeks).toHaveLength(2);
    expect(grid.weeks[0][0].date).toBe('2025-12-28'); // first column, Sunday
    expect(grid.weeks[1][0].date).toBe('2026-01-04'); // second column, Sunday
    expect(grid.weeks[1][6].date).toBe('2026-01-10'); // last cell, Saturday = endDate
  });

  it('buckets levels relative to the busiest day and fills gaps with zero', () => {
    const grid = buildContributionGrid([day('2026-01-04', 2), day('2026-01-05', 10)], 'plays', {
      weeks: 2,
      endDate: '2026-01-10'
    });

    expect(grid.maxValue).toBe(10);
    expect(grid.total).toBe(12);
    expect(grid.weeks[1][0]).toMatchObject({ date: '2026-01-04', value: 2, level: 1 });
    expect(grid.weeks[1][1]).toMatchObject({ date: '2026-01-05', value: 10, level: 4 });
    // 2026-01-06 has no data -> in range, zero, level 0
    expect(grid.weeks[1][2]).toMatchObject({ date: '2026-01-06', value: 0, level: 0, inRange: true });
  });

  it('marks cells after the end date as out of range (padding)', () => {
    // 2026-01-08 is a Thursday (dow 4); a 1-week window is 2026-01-04..2026-01-10.
    const grid = buildContributionGrid([day('2026-01-08', 5)], 'plays', {
      weeks: 1,
      endDate: '2026-01-08'
    });

    expect(grid.weeks[0][4]).toMatchObject({ date: '2026-01-08', inRange: true });
    expect(grid.weeks[0][5]).toMatchObject({ date: '2026-01-09', inRange: false });
    expect(grid.weeks[0][6]).toMatchObject({ date: '2026-01-10', inRange: false });
  });

  it('honours the chosen metric', () => {
    const days = [day('2026-01-05', 3, 120)];
    expect(buildContributionGrid(days, 'minutes', { weeks: 1, endDate: '2026-01-10' }).maxValue).toBe(120);
    expect(buildContributionGrid(days, 'plays', { weeks: 1, endDate: '2026-01-10' }).maxValue).toBe(3);
  });

  it('drops a short leading month label that would clash with the next', () => {
    // Window is Jan 25 (Sun)..Feb 7: Jan is a single partial column, so its
    // label is dropped to avoid overlapping 'Feb'.
    const grid = buildContributionGrid([day('2026-02-02', 1)], 'plays', {
      weeks: 2,
      endDate: '2026-02-07'
    });
    expect(grid.monthLabels).toEqual([{ column: 1, label: 'Feb' }]);
  });

  it('keeps month labels spaced far enough apart', () => {
    // Jan spans 4 columns before Feb begins, so both labels are kept.
    const grid = buildContributionGrid([day('2026-02-02', 1)], 'plays', {
      weeks: 8,
      endDate: '2026-02-28'
    });
    expect(grid.monthLabels).toEqual([
      { column: 0, label: 'Jan' },
      { column: 4, label: 'Feb' }
    ]);
  });
});
