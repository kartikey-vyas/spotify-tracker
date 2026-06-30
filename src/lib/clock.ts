import type { ClockBucket } from '$lib/types';

/**
 * Collapses the sparse (weekday, hour) play buckets into a 24-hour, time-of-day
 * profile for the radial listening clock. Pure and deterministic: weekdays are
 * summed away, leaving one slice per hour (0–23) with a `fraction` (0–1) of the
 * busiest hour for radial length.
 */

const HOURS_PER_DAY = 24;

export interface HourSlice {
  /** 0–23. */
  hour: number;
  value: number;
  /** value / maxValue, in [0, 1]; 0 when there are no plays. */
  fraction: number;
}

export interface HourClock {
  /** Always 24 slices, ordered hour 0 → 23. */
  hours: HourSlice[];
  /** Plays in the busiest hour (≥ 0). */
  maxValue: number;
  total: number;
  /** Busiest hour (earliest on ties), or null when there's no data. */
  peakHour: number | null;
}

export function buildHourClock(buckets: ClockBucket[]): HourClock {
  const byHour = new Array<number>(HOURS_PER_DAY).fill(0);
  let total = 0;
  for (const { hour, plays } of buckets) {
    if (hour >= 0 && hour < HOURS_PER_DAY) {
      byHour[hour] += plays;
      total += plays;
    }
  }

  const maxValue = Math.max(0, ...byHour);
  const safeMax = Math.max(1, maxValue);
  const hours: HourSlice[] = byHour.map((value, hour) => ({
    hour,
    value,
    fraction: value / safeMax
  }));

  const peakHour = maxValue > 0 ? byHour.indexOf(maxValue) : null;

  return { hours, maxValue, total, peakHour };
}
