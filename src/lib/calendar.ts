import type { CalendarDay } from '$lib/types';

/**
 * Builds the data for a GitHub-style contribution graph from a list of daily
 * listening totals. Pure and deterministic: pass `endDate` for stable output
 * (defaults to the most recent date present in `days`).
 */

export type CalendarMetric = 'plays' | 'minutes';

/** 0 = no activity; 1–4 = increasing intensity relative to the busiest day. */
export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export interface ContributionCell {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  value: number;
  level: ContributionLevel;
  /** False for trailing cells after `endDate` (future padding); render blank. */
  inRange: boolean;
}

export interface MonthLabel {
  /** Index into `weeks` where this month's label should sit. */
  column: number;
  label: string;
}

export interface ContributionGrid {
  /** Columns of 7 cells each, row 0 = Sunday. */
  weeks: ContributionCell[][];
  monthLabels: MonthLabel[];
  /** Highest single-day value across the visible range (≥ 0). */
  maxValue: number;
  /** Sum of all in-range values. */
  total: number;
}

export interface BuildGridOptions {
  /** Number of week columns to render. */
  weeks?: number;
  /** ISO `YYYY-MM-DD` of the most recent day to show. Defaults to max date in `days`. */
  endDate?: string;
}

export const DEFAULT_WEEKS = 53;
const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;
/** Minimum columns between month labels; closer ones overlap, so the earlier is dropped. */
const MIN_MONTH_LABEL_GAP = 3;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

/** Day-of-week labels by row index (Sunday = 0); blanks render no label. */
export const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''] as const;

function parseISODate(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function toISODate(ms: number): string {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayValue(day: CalendarDay, metric: CalendarMetric): number {
  return metric === 'plays' ? day.plays : day.minutes;
}

function levelFor(value: number, maxValue: number): ContributionLevel {
  if (value <= 0) return 0;
  return Math.min(4, Math.ceil((value / maxValue) * 4)) as ContributionLevel;
}

function emptyGrid(): ContributionGrid {
  return { weeks: [], monthLabels: [], maxValue: 0, total: 0 };
}

export function buildContributionGrid(
  days: CalendarDay[],
  metric: CalendarMetric,
  options: BuildGridOptions = {}
): ContributionGrid {
  if (days.length === 0) return emptyGrid();

  const weekCount = options.weeks ?? DEFAULT_WEEKS;

  const valueByDate = new Map<string, number>();
  let maxDateMs = -Infinity;
  for (const day of days) {
    valueByDate.set(day.local_date, dayValue(day, metric));
    maxDateMs = Math.max(maxDateMs, parseISODate(day.local_date));
  }

  const endMs = options.endDate ? parseISODate(options.endDate) : maxDateMs;
  // Align the rightmost column to the week containing endDate (Sunday-first).
  const lastSundayMs = endMs - new Date(endMs).getUTCDay() * MS_PER_DAY;
  const firstSundayMs = lastSundayMs - (weekCount - 1) * DAYS_PER_WEEK * MS_PER_DAY;

  let maxValue = 0;
  let total = 0;
  const cellsByWeek: Array<Array<Omit<ContributionCell, 'level'>>> = [];
  for (let week = 0; week < weekCount; week += 1) {
    const column: Array<Omit<ContributionCell, 'level'>> = [];
    for (let row = 0; row < DAYS_PER_WEEK; row += 1) {
      const ms = firstSundayMs + (week * DAYS_PER_WEEK + row) * MS_PER_DAY;
      const inRange = ms <= endMs;
      const value = inRange ? (valueByDate.get(toISODate(ms)) ?? 0) : 0;
      if (inRange) {
        total += value;
        maxValue = Math.max(maxValue, value);
      }
      column.push({ date: toISODate(ms), value, inRange });
    }
    cellsByWeek.push(column);
  }

  const safeMax = Math.max(1, maxValue);
  const weeks: ContributionCell[][] = cellsByWeek.map((column) =>
    column.map((cell) => ({ ...cell, level: cell.inRange ? levelFor(cell.value, safeMax) : 0 }))
  );

  const rawMonthLabels: MonthLabel[] = [];
  let lastMonth = -1;
  weeks.forEach((column, index) => {
    const month = new Date(parseISODate(column[0].date)).getUTCMonth();
    if (month !== lastMonth) {
      rawMonthLabels.push({ column: index, label: MONTH_NAMES[month] });
      lastMonth = month;
    }
  });
  // Drop a label when the next month starts too soon to fit the text — this
  // removes the short leading partial month whose label would otherwise clash.
  const monthLabels = rawMonthLabels.filter((label, index) => {
    const next = rawMonthLabels[index + 1];
    return !next || next.column - label.column >= MIN_MONTH_LABEL_GAP;
  });

  return { weeks, monthLabels, maxValue, total };
}
