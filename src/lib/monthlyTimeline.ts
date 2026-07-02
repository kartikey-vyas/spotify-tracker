import type { CalendarDay } from './types';

const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
});

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
});

const MIN_DAYS_BETWEEN_LABELS = 21;
const MIN_MONTHS_BETWEEN_LABELS = 6;

export type TimelineBucketMode = 'day' | 'month';

export type TimelineHistogramBucket = {
  key: string;
  label: string;
  minutes: number;
  plays: number;
};

export function formatMonthLabel(monthStart: string): string {
  return monthFormatter.format(new Date(`${monthStart}T00:00:00Z`));
}

function formatDayLabel(localDate: string): string {
  return dayFormatter.format(new Date(`${localDate}T00:00:00Z`));
}

function daysInclusive(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function monthStart(localDate: string): string {
  return `${localDate.slice(0, 7)}-01`;
}

export function timelineBucketMode(start: string, end: string): TimelineBucketMode {
  return daysInclusive(start, end) >= 365 ? 'month' : 'day';
}

export function buildTimelineHistogram(days: CalendarDay[], start: string, end: string): TimelineHistogramBucket[] {
  const mode = timelineBucketMode(start, end);
  const byKey = new Map<string, TimelineHistogramBucket>();

  for (const day of days) {
    const key = mode === 'month' ? monthStart(day.local_date) : day.local_date;
    const current = byKey.get(key) ?? { key, label: '', minutes: 0, plays: 0 };
    current.minutes += day.minutes;
    current.plays += day.plays;
    byKey.set(key, current);
  }

  return [...byKey.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((bucket, index, buckets) => ({
      ...bucket,
      label: sparseLabel(bucket.key, index, buckets, mode)
    }))
    .map((bucket, index, buckets) => ({
      ...bucket,
      label: labelIsTooClose(bucket, index, buckets, mode) ? '' : bucket.label
    }));
}

function labelIsTooClose(
  bucket: TimelineHistogramBucket,
  index: number,
  buckets: TimelineHistogramBucket[],
  mode: TimelineBucketMode
): boolean {
  if (!bucket.label) return false;

  const previousLabeled = buckets
    .slice(0, index)
    .reverse()
    .find((candidate) => candidate.label);
  if (!previousLabeled) return false;

  if (mode === 'month') {
    return monthsBetween(previousLabeled.key, bucket.key) < MIN_MONTHS_BETWEEN_LABELS;
  }

  return daysBetween(previousLabeled.key, bucket.key) < MIN_DAYS_BETWEEN_LABELS;
}

function monthsBetween(start: string, end: string): number {
  return (
    (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
    Number(end.slice(5, 7)) -
    Number(start.slice(5, 7))
  );
}

function daysBetween(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((endMs - startMs) / 86_400_000);
}

function sparseLabel(
  key: string,
  index: number,
  buckets: TimelineHistogramBucket[],
  mode: TimelineBucketMode
): string {
  if (index === 0) return mode === 'month' ? formatMonthLabel(key) : formatDayLabel(key);

  const previous = buckets[index - 1];
  if (mode === 'day') {
    return key.slice(0, 7) !== previous.key.slice(0, 7) ? formatDayLabel(key) : '';
  }

  const isJanuary = key.slice(5, 7) === '01';
  const yearChanged = key.slice(0, 4) !== previous.key.slice(0, 4);
  return isJanuary || yearChanged ? formatMonthLabel(key) : '';
}

export function monthlyBarWidth(value: number, maxValue: number): number {
  if (value <= 0) return 0;
  if (maxValue <= 0) return 100;
  return Math.min(100, Math.max(4, Math.round((value / maxValue) * 100)));
}
