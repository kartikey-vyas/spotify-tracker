import type { ReleaseYearBucket } from '$lib/types';

export const EARLIEST_RELEASE_YEAR = 1950;

/**
 * Builds a release-year histogram from sparse per-year play counts. Pure and
 * deterministic. Releases from the cutoff year or earlier share the first
 * bucket, then bars span every year through the latest present (gaps
 * zero-filled) in ascending order. Each carries a `fraction` (0–1) of the
 * busiest bucket for bar heights.
 */

export interface ReleaseYearBar {
  year: number;
  value: number;
  /** value / maxValue, in [0, 1]; 0 when there are no plays. */
  fraction: number;
}

export interface ReleaseYearChart {
  bars: ReleaseYearBar[];
  maxValue: number;
  total: number;
}

export function buildReleaseYearChart(buckets: ReleaseYearBucket[]): ReleaseYearChart {
  if (buckets.length === 0) return { bars: [], maxValue: 0, total: 0 };

  const playsByYear = new Map<number, number>();
  let total = 0;
  for (const { year, plays } of buckets) {
    const bucketYear = Math.max(year, EARLIEST_RELEASE_YEAR);
    playsByYear.set(bucketYear, (playsByYear.get(bucketYear) ?? 0) + plays);
    total += plays;
  }

  const years = [...playsByYear.keys()];
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const maxValue = Math.max(0, ...playsByYear.values());
  const safeMax = Math.max(1, maxValue);

  const bars: ReleaseYearBar[] = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    const value = playsByYear.get(year) ?? 0;
    bars.push({ year, value, fraction: value / safeMax });
  }

  return { bars, maxValue, total };
}
