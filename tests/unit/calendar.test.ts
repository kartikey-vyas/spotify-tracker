import { describe, expect, it } from 'vitest';
import { availableYears, buildContributionGrid, buildYearGrid } from '../../src/lib/calendar.js';
import type { CalendarDay } from '../../src/lib/types.js';

const cellByDate = (grid: ReturnType<typeof buildYearGrid>, date: string) =>
  grid.weeks.flat().find((cell) => cell.date === date);

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

describe('availableYears', () => {
  it('returns distinct years with data, newest first', () => {
    expect(
      availableYears([
        day('2019-05-01', 1),
        day('2020-01-02', 3),
        day('2026-06-29', 2),
        day('2020-12-31', 1)
      ])
    ).toEqual([2026, 2020, 2019]);
  });

  it('is empty for no data', () => {
    expect(availableYears([])).toEqual([]);
  });
});

describe('buildYearGrid', () => {
  it('returns an empty grid for no data', () => {
    expect(buildYearGrid([], 2021, 'plays')).toEqual({
      weeks: [],
      monthLabels: [],
      maxValue: 0,
      total: 0
    });
  });

  it('lays out a full year Sunday-first, padding days outside the year', () => {
    // Jan 1 2021 is a Friday; grid runs Sun 2020-12-27 .. Sat 2022-01-01 (53 cols).
    const grid = buildYearGrid([day('2021-06-01', 1)], 2021, 'plays');
    expect(grid.weeks).toHaveLength(53);
    expect(grid.weeks[0][0]).toMatchObject({ date: '2020-12-27', inRange: false });
    expect(grid.weeks[0][5]).toMatchObject({ date: '2021-01-01', inRange: true });
    expect(grid.weeks[52][5]).toMatchObject({ date: '2021-12-31', inRange: true });
    expect(grid.weeks[52][6]).toMatchObject({ date: '2022-01-01', inRange: false });
  });

  it('buckets levels relative to that year and fills gaps with zero', () => {
    const grid = buildYearGrid([day('2021-03-01', 2), day('2021-03-02', 10)], 2021, 'plays');
    expect(grid.maxValue).toBe(10);
    expect(grid.total).toBe(12);
    expect(cellByDate(grid, '2021-03-01')).toMatchObject({ value: 2, level: 1 });
    expect(cellByDate(grid, '2021-03-02')).toMatchObject({ value: 10, level: 4 });
    expect(cellByDate(grid, '2021-03-03')).toMatchObject({ value: 0, level: 0, inRange: true });
  });

  it('ignores data from other years', () => {
    const grid = buildYearGrid([day('2020-06-01', 100), day('2021-06-01', 5)], 2021, 'plays');
    expect(grid.maxValue).toBe(5);
    expect(grid.total).toBe(5);
    expect(cellByDate(grid, '2020-06-01')).toBeUndefined();
  });

  it('caps the current year at the end date (future days are padding)', () => {
    const grid = buildYearGrid([day('2026-06-30', 4)], 2026, 'plays', { endDate: '2026-06-30' });
    expect(cellByDate(grid, '2026-06-30')).toMatchObject({ inRange: true, value: 4 });
    expect(cellByDate(grid, '2026-07-01')).toMatchObject({ inRange: false });
  });

  it('labels every month of a full year, starting at column 0', () => {
    const grid = buildYearGrid([day('2021-06-01', 1)], 2021, 'plays');
    expect(grid.monthLabels.map((label) => label.label)).toEqual([
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ]);
    expect(grid.monthLabels[0].column).toBe(0);
  });
});
