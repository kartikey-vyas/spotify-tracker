import { describe, expect, it } from 'vitest';
import { buildClockGrid } from '../../src/lib/clock.js';
import type { ClockBucket } from '../../src/lib/types.js';

const bucket = (dow: number, hour: number, plays: number): ClockBucket => ({ dow, hour, plays });

describe('buildClockGrid', () => {
  it('returns an empty grid for no data', () => {
    expect(buildClockGrid([])).toEqual({ rows: [], maxValue: 0, total: 0 });
  });

  it('lays out 7 rows of 24 hours, Monday first through Sunday', () => {
    const grid = buildClockGrid([bucket(1, 9, 1)]);
    expect(grid.rows).toHaveLength(7);
    expect(grid.rows.map((row) => row.label)).toEqual([
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
    ]);
    for (const row of grid.rows) {
      expect(row.cells).toHaveLength(24);
      expect(row.cells.map((cell) => cell.hour)).toEqual([...Array(24).keys()]);
    }
  });

  it('places counts at the right weekday/hour and zero-fills the rest', () => {
    const grid = buildClockGrid([bucket(1, 23, 10)]);
    expect(grid.maxValue).toBe(10);
    expect(grid.total).toBe(10);
    const monday = grid.rows[0];
    expect(monday.label).toBe('Mon');
    expect(monday.cells[23]).toMatchObject({ hour: 23, value: 10, level: 4 });
    expect(monday.cells[0]).toMatchObject({ hour: 0, value: 0, level: 0 });
  });

  it('maps Sunday (dow 0) to the last row and Saturday (dow 6) to the sixth', () => {
    const grid = buildClockGrid([bucket(0, 8, 3), bucket(6, 8, 4)]);
    expect(grid.rows[6].label).toBe('Sun');
    expect(grid.rows[6].cells[8].value).toBe(3);
    expect(grid.rows[5].label).toBe('Sat');
    expect(grid.rows[5].cells[8].value).toBe(4);
  });

  it('buckets levels relative to the busiest cell', () => {
    // dow 3 = Wednesday (0=Sun..6=Sat), which renders as the third row.
    const grid = buildClockGrid([bucket(3, 9, 1), bucket(3, 10, 4)]);
    expect(grid.maxValue).toBe(4);
    expect(grid.total).toBe(5);
    const wednesday = grid.rows[2];
    expect(wednesday.label).toBe('Wed');
    expect(wednesday.cells[9]).toMatchObject({ value: 1, level: 1 });
    expect(wednesday.cells[10]).toMatchObject({ value: 4, level: 4 });
  });
});
