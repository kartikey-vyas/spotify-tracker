import { describe, expect, it } from 'vitest';
import { buildYearGrid, yearTotals } from '../../src/lib/calendar.js';
import type { CalendarDay } from '../../src/lib/types.js';

const cellByDate = (grid: ReturnType<typeof buildYearGrid>, date: string) =>
  grid.weeks.flat().find((cell) => cell.date === date);

const day = (local_date: string, plays: number, minutes = 0): CalendarDay => ({
  local_date,
  plays,
  minutes
});

describe('yearTotals', () => {
  const sample = [
    day('2019-05-01', 1),
    day('2020-01-02', 3),
    day('2026-06-29', 2),
    day('2020-12-31', 1)
  ];

  it('returns distinct years with data, newest first', () => {
    expect(yearTotals(sample, 'plays').map((total) => total.year)).toEqual([2026, 2020, 2019]);
  });

  it('sums each year and shares it against the busiest one', () => {
    // 2020 is the busiest at 4, so it is the 1.0 the others are measured against.
    expect(yearTotals(sample, 'plays')).toEqual([
      { year: 2026, value: 2, share: 0.5 },
      { year: 2020, value: 4, share: 1 },
      { year: 2019, value: 1, share: 0.25 }
    ]);
  });

  it('totals the metric it is asked for, not always plays', () => {
    const days = [day('2021-01-01', 9, 40), day('2021-01-02', 9, 10)];
    expect(yearTotals(days, 'minutes')).toEqual([{ year: 2021, value: 50, share: 1 }]);
  });

  it('still offers a year whose total is zero under this metric', () => {
    // Plays-only rows (API source, no duration) total 0 minutes but are real
    // years with real squares, so the picker must not drop them or divide by 0.
    expect(yearTotals([day('2022-03-04', 5, 0)], 'minutes')).toEqual([
      { year: 2022, value: 0, share: 0 }
    ]);
  });

  it('is empty for no data', () => {
    expect(yearTotals([], 'plays')).toEqual([]);
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

  it('renders future days of the current year as empty (least-shade) squares', () => {
    const grid = buildYearGrid([day('2026-06-30', 4)], 2026, 'plays', { endDate: '2026-06-30' });
    // Today carries its real value.
    expect(cellByDate(grid, '2026-06-30')).toMatchObject({ inRange: true, value: 4 });
    // A future day still in 2026 is a square, but empty (level 0) and uncounted.
    expect(cellByDate(grid, '2026-07-01')).toMatchObject({ inRange: true, value: 0, level: 0 });
    expect(grid.total).toBe(4);
    // A day outside the year stays grid padding (blank).
    expect(cellByDate(grid, '2027-01-01')).toMatchObject({ inRange: false });
  });

  it('labels every month of a full year, starting at column 0', () => {
    const grid = buildYearGrid([day('2021-06-01', 1)], 2021, 'plays');
    expect(grid.monthLabels.map((label) => label.label)).toEqual([
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ]);
    expect(grid.monthLabels[0].column).toBe(0);
  });
});
