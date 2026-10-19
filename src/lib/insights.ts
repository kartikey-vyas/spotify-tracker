import type {
  HourTagBucket,
  HourTagPart,
  PopularityStripRow,
  PopularitySummary,
  PopularityYear
} from '$lib/types';

/**
 * Display rules for the daily insights cache: the global popularity score and
 * the hour tags. Pure and DOM-free. The bands live here, not in SQL, so they
 * can be retuned without a migration. See docs/popularity-score-plan.md.
 */

/** Ordered quietest first; each band holds listener counts below `below`. */
export const POPULARITY_BANDS = [
  { label: 'deep underground', below: 25_000 },
  { label: 'underground', below: 100_000 },
  { label: 'cult', below: 500_000 },
  { label: 'well known', below: 2_000_000 },
  { label: 'mainstream', below: Number.POSITIVE_INFINITY }
] as const;

export type PopularityBand = (typeof POPULARITY_BANDS)[number]['label'];

/** A median is shown only when enough of the window's plays back it. */
export const MIN_COVERED_PLAYS = 50;
export const MIN_COVERAGE = 0.5;

/** The log axis the comparison strip draws on. */
export const SCALE_MIN = 10_000;
export const SCALE_MAX = 10_000_000;

export function bandFor(listeners: number): PopularityBand {
  for (const band of POPULARITY_BANDS) {
    if (listeners < band.below) return band.label;
  }
  return POPULARITY_BANDS[POPULARITY_BANDS.length - 1].label;
}

/** The window's median, or null when too few plays have a listener count. */
export function reliableMedian(summary: PopularitySummary | null | undefined): number | null {
  if (!summary || summary.median_artist_listeners === null) return null;
  if (summary.covered_plays < MIN_COVERED_PLAYS) return null;
  if (summary.plays === 0 || summary.covered_plays / summary.plays < MIN_COVERAGE) return null;
  return summary.median_artist_listeners;
}

/** "950", "1.3k", "136k", "1.3M", "13M". One decimal only below ten units. */
export function formatListeners(count: number): string {
  // Each threshold sits half a unit low, so 999,950 reads "1M", not "1000k".
  const units: Array<[number, number, string]> = [
    [999_500, 1_000_000, 'M'],
    [999.5, 1_000, 'k']
  ];
  for (const [threshold, size, suffix] of units) {
    if (count >= threshold) {
      const value = count / size;
      const text = value < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
      return `${text}${suffix}`;
    }
  }
  return String(Math.round(count));
}

/** Position on the strip's log axis, clamped to [0, 1]. */
export function scalePosition(listeners: number): number {
  const span = Math.log10(SCALE_MAX) - Math.log10(SCALE_MIN);
  const position = (Math.log10(Math.max(listeners, 1)) - Math.log10(SCALE_MIN)) / span;
  return Math.min(1, Math.max(0, position));
}

/** Band boundaries that fall inside the axis, for tick marks. */
export function bandTicks(): Array<{ listeners: number; position: number }> {
  return POPULARITY_BANDS.filter((band) => band.below > SCALE_MIN && band.below < SCALE_MAX).map(
    (band) => ({ listeners: band.below, position: scalePosition(band.below) })
  );
}

export type StripEntry = {
  slug: string;
  name: string;
  listeners: number;
  band: PopularityBand;
  position: number;
  selected: boolean;
};

/** Profiles with a reliable all-time score, most underground first. */
export function buildStrip(rows: PopularityStripRow[], selectedSlug: string): StripEntry[] {
  const entries: StripEntry[] = [];
  for (const row of rows) {
    const listeners = reliableMedian(row.all_time);
    if (listeners === null) continue;
    entries.push({
      slug: row.slug,
      name: row.display_name,
      listeners,
      band: bandFor(listeners),
      position: scalePosition(listeners),
      selected: row.slug === selectedSlug
    });
  }
  return entries.sort((left, right) => left.listeners - right.listeners || left.slug.localeCompare(right.slug));
}

export type YearBar = {
  year: number;
  listeners: number;
  band: PopularityBand;
  /** listeners / the highest year, in (0, 1]. */
  fraction: number;
  /** The most underground year shown. */
  lowest: boolean;
};

/** Years with a reliable median, ascending, with bar heights. */
export function buildYearSeries(years: PopularityYear[]): YearBar[] {
  const reliable = years
    .map((year) => ({ year: year.year, listeners: reliableMedian(year) }))
    .filter((year): year is { year: number; listeners: number } => year.listeners !== null)
    .sort((left, right) => left.year - right.year);
  if (reliable.length === 0) return [];

  const max = Math.max(...reliable.map((year) => year.listeners));
  const min = Math.min(...reliable.map((year) => year.listeners));
  // Earliest year wins a tie, so exactly one bar is marked.
  const lowestYear = reliable.find((year) => year.listeners === min)?.year;

  return reliable.map((year) => ({
    year: year.year,
    listeners: year.listeners,
    band: bandFor(year.listeners),
    fraction: year.listeners / max,
    lowest: year.year === lowestYear
  }));
}

export const HOUR_PART_NAMES: Record<HourTagPart, string> = {
  late_night: 'Late night',
  morning: 'Morning',
  day: 'Day',
  evening: 'Evening',
  night: 'Night'
};

const pad = (hour: number): string => String(hour).padStart(2, '0');

/** "05–09": the part's hours as a half-open clock range. */
export function hourRange(bucket: Pick<HourTagBucket, 'first_hour' | 'last_hour'>): string {
  return `${pad(bucket.first_hour)}–${pad(bucket.last_hour + 1)}`;
}

/** "2.0×": one decimal, so 1.97 and 2.04 read the same. */
export function formatLift(lift: number): string {
  return `${lift.toFixed(1)}×`;
}

/** True when at least one part of the day has something to show. */
export function hasHourTags(buckets: HourTagBucket[] | null | undefined): boolean {
  return (buckets ?? []).some((bucket) => bucket.labels.length > 0);
}
