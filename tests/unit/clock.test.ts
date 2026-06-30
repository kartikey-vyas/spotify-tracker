import { describe, expect, it } from 'vitest';
import { buildHourClock } from '../../src/lib/clock.js';
import type { ClockBucket } from '../../src/lib/types.js';

const bucket = (dow: number, hour: number, plays: number): ClockBucket => ({ dow, hour, plays });

describe('buildHourClock', () => {
  it('returns 24 empty hours for no data', () => {
    const clock = buildHourClock([]);
    expect(clock.hours).toHaveLength(24);
    expect(clock.hours.every((slice) => slice.value === 0 && slice.fraction === 0)).toBe(true);
    expect(clock).toMatchObject({ maxValue: 0, total: 0, peakHour: null });
  });

  it('sums plays across weekdays into one slice per hour', () => {
    const clock = buildHourClock([bucket(1, 9, 2), bucket(3, 9, 3), bucket(0, 22, 5)]);
    expect(clock.hours).toHaveLength(24);
    expect(clock.hours[9].value).toBe(5);
    expect(clock.hours[22].value).toBe(5);
    expect(clock.total).toBe(10);
    expect(clock.maxValue).toBe(5);
  });

  it('sets fraction relative to the busiest hour and reports the peak', () => {
    const clock = buildHourClock([bucket(1, 8, 1), bucket(1, 20, 4)]);
    expect(clock.hours[8]).toMatchObject({ hour: 8, value: 1, fraction: 0.25 });
    expect(clock.hours[20]).toMatchObject({ hour: 20, value: 4, fraction: 1 });
    expect(clock.peakHour).toBe(20);
  });

  it('orders slices 0..23', () => {
    const clock = buildHourClock([bucket(0, 0, 1)]);
    expect(clock.hours.map((slice) => slice.hour)).toEqual([...Array(24).keys()]);
  });
});
