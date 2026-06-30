import { describe, expect, it } from 'vitest';
import { buildReleaseYearChart } from '../../src/lib/release-years.js';
import type { ReleaseYearBucket } from '../../src/lib/types.js';

const at = (year: number, plays: number): ReleaseYearBucket => ({ year, plays });

describe('buildReleaseYearChart', () => {
  it('returns an empty chart for no data', () => {
    expect(buildReleaseYearChart([])).toEqual({ bars: [], maxValue: 0, total: 0 });
  });

  it('fills the gap years between the earliest and latest with zero bars', () => {
    const chart = buildReleaseYearChart([at(2021, 10), at(2018, 5)]);
    expect(chart.bars.map((bar) => bar.year)).toEqual([2018, 2019, 2020, 2021]);
    expect(chart.bars.map((bar) => bar.value)).toEqual([5, 0, 0, 10]);
    expect(chart.maxValue).toBe(10);
    expect(chart.total).toBe(15);
  });

  it('sets fraction relative to the busiest year', () => {
    const chart = buildReleaseYearChart([at(2018, 5), at(2021, 10)]);
    expect(chart.bars[0]).toMatchObject({ year: 2018, value: 5, fraction: 0.5 });
    expect(chart.bars[3]).toMatchObject({ year: 2021, value: 10, fraction: 1 });
    expect(chart.bars[1].fraction).toBe(0);
  });

  it('handles a single year', () => {
    const chart = buildReleaseYearChart([at(2020, 7)]);
    expect(chart.bars).toEqual([{ year: 2020, value: 7, fraction: 1 }]);
    expect(chart.maxValue).toBe(7);
    expect(chart.total).toBe(7);
  });

  it('sums duplicate years and orders ascending', () => {
    const chart = buildReleaseYearChart([at(2020, 3), at(2019, 1), at(2020, 4)]);
    expect(chart.bars.map((bar) => bar.year)).toEqual([2019, 2020]);
    expect(chart.bars.map((bar) => bar.value)).toEqual([1, 7]);
    expect(chart.total).toBe(8);
  });
});
