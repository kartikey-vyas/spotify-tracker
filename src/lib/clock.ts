import type { ClockBucket } from '$lib/types';

/**
 * Builds a 24×7 listening-clock heatmap from sparse (weekday, hour) play counts.
 * Pure and deterministic. Rows run Monday → Sunday; each row has 24 hour cells
 * (0–23), zero-filled where there's no data, with intensity levels relative to
 * the single busiest cell.
 */

/** 0 = no activity; 1–4 = increasing intensity relative to the busiest cell. */
export type ClockLevel = 0 | 1 | 2 | 3 | 4;

export interface ClockCell {
  hour: number;
  value: number;
  level: ClockLevel;
}

export interface ClockRow {
  /** Source day-of-week, 0=Sun..6=Sat. */
  dayIndex: number;
  label: string;
  cells: ClockCell[];
}

export interface ClockGrid {
  /** Seven rows, Monday first through Sunday. */
  rows: ClockRow[];
  /** Highest single-cell value (≥ 0). */
  maxValue: number;
  /** Sum of all plays. */
  total: number;
}

const HOURS_PER_DAY = 24;
/** Display order: Monday first, Sunday last (values are 0=Sun..6=Sat). */
const DISPLAY_DAYS: ReadonlyArray<{ dayIndex: number; label: string }> = [
  { dayIndex: 1, label: 'Mon' },
  { dayIndex: 2, label: 'Tue' },
  { dayIndex: 3, label: 'Wed' },
  { dayIndex: 4, label: 'Thu' },
  { dayIndex: 5, label: 'Fri' },
  { dayIndex: 6, label: 'Sat' },
  { dayIndex: 0, label: 'Sun' }
];

function levelFor(value: number, maxValue: number): ClockLevel {
  if (value <= 0) return 0;
  return Math.min(4, Math.ceil((value / maxValue) * 4)) as ClockLevel;
}

export function buildClockGrid(buckets: ClockBucket[]): ClockGrid {
  if (buckets.length === 0) return { rows: [], maxValue: 0, total: 0 };

  const valueByKey = new Map<string, number>();
  let maxValue = 0;
  let total = 0;
  for (const { dow, hour, plays } of buckets) {
    const key = `${dow}:${hour}`;
    const value = (valueByKey.get(key) ?? 0) + plays;
    valueByKey.set(key, value);
    total += plays;
    maxValue = Math.max(maxValue, value);
  }

  const safeMax = Math.max(1, maxValue);
  const rows: ClockRow[] = DISPLAY_DAYS.map(({ dayIndex, label }) => ({
    dayIndex,
    label,
    cells: Array.from({ length: HOURS_PER_DAY }, (_unused, hour) => {
      const value = valueByKey.get(`${dayIndex}:${hour}`) ?? 0;
      return { hour, value, level: levelFor(value, safeMax) };
    })
  }));

  return { rows, maxValue, total };
}
