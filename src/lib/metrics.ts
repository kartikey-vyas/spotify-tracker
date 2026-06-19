import type { Metric, RankingRow } from './types';

export const metricOptions: Array<{ value: Metric; label: string }> = [
  { value: 'minutes', label: 'Minutes' },
  { value: 'plays', label: 'Plays' },
  { value: 'qualified_plays', label: 'Qualified plays' },
  { value: 'unique_tracks', label: 'Unique tracks' },
  { value: 'skip_rate', label: 'Skip rate' }
];

export function metricValue(row: RankingRow, metric: Metric): number {
  if (metric === 'skip_rate') {
    return row.known_skip_count > 0 ? row.skipped_count / row.known_skip_count : 0;
  }

  return row[metric];
}

export function formatMetric(value: number, metric: Metric): string {
  if (metric === 'skip_rate') return `${Math.round(value * 100)}%`;
  if (metric === 'minutes') return `${Math.round(value).toLocaleString()} min`;
  return Math.round(value).toLocaleString();
}

export function metricLabel(metric: Metric): string {
  if (metric === 'minutes') return 'Minutes';
  if (metric === 'plays') return 'Plays';
  if (metric === 'qualified_plays') return 'Qualified plays';
  if (metric === 'unique_tracks') return 'Unique tracks';
  if (metric === 'skip_rate') return 'Skip rate';
  return 'Metric';
}

export function bestAvailableMetric(rows: RankingRow[], preferred: Metric = 'minutes'): Metric {
  if (preferred === 'minutes') {
    const hasMinutes = rows.some((row) => row.minutes > 0);
    const hasApiOnlyPlays = rows.some((row) => row.plays > 0 && row.unknown_duration_plays > 0);
    if (!hasMinutes && hasApiOnlyPlays) return 'plays';
  }

  return preferred;
}

export function formatMinutes(value: number): string {
  if (value >= 60) {
    return `${(value / 60).toFixed(1)} hr`;
  }
  return `${Math.round(value)} min`;
}

export function qualityLabel(dataQuality: number): string {
  if (dataQuality === 1) return 'Exact';
  if (dataQuality === 2) return 'Play-count only';
  if (dataQuality === 3) return 'Inferred';
  return 'Unknown';
}

export function sourceLabel(source: number): string {
  if (source === 1) return 'Export';
  if (source === 2) return 'API';
  if (source === 3) return 'Player';
  return 'Unknown';
}
