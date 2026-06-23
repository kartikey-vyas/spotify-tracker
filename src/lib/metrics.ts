import type { Metric, OverviewPayload, RankingRow } from './types';

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

export function isMetricAvailable(rows: RankingRow[], metric: Metric): boolean {
  if (rows.length === 0) return metric === 'plays';
  if (metric === 'plays') return rows.some((row) => row.plays > 0);
  if (metric === 'unique_tracks') return rows.some((row) => row.unique_tracks > 0);
  if (metric === 'minutes') return rows.some((row) => row.minutes > 0);
  if (metric === 'qualified_plays') return rows.some((row) => row.minutes > 0);
  if (metric === 'skip_rate') return rows.some((row) => row.known_skip_count > 0);
  return false;
}

export function disabledMetricLabel(metric: Metric): string {
  if (metric === 'minutes') return 'Minutes (needs export)';
  if (metric === 'qualified_plays') return 'Qualified plays (needs export)';
  if (metric === 'skip_rate') return 'Skip rate (needs export)';
  return metricLabel(metric);
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

// Headline value for a summary card. Plays is the metric we rank and report on:
// it is recorded consistently across both the export and the API, whereas
// API-only data carries no duration, so a minutes headline understates recent
// listening.
export function summaryValue(plays: number): string {
  return `${plays.toLocaleString()} plays`;
}

// The secondary line on a summary card. Returns a caption so the top artist
// reads as a separate fact ("Top artist · toe") rather than describing the
// headline number.
export function topArtistDetail(name: string | null | undefined): { caption: string; detail: string } {
  return name ? { caption: 'Top artist', detail: name } : { caption: '', detail: 'No plays yet' };
}

export type SummaryCard = { label: string; value: string; caption: string; detail: string };

function totalPlays(rows: RankingRow[]): number {
  return rows.reduce((total, row) => total + row.plays, 0);
}

// The standard Last 7 days / Last 30 days summary cards shared by the /app and
// /profile headers. The homepage builds its own set (it adds a Today card and
// derives play counts from the calendar).
export function overviewSummaryCards(overview: OverviewPayload): SummaryCard[] {
  return [
    {
      label: 'Last 7 days',
      value: summaryValue(totalPlays(overview.this_week.top_artists)),
      ...topArtistDetail(overview.this_week.top_artists[0]?.entity_name)
    },
    {
      label: 'Last 30 days',
      value: summaryValue(totalPlays(overview.last_30_days.top_artists)),
      ...topArtistDetail(overview.last_30_days.top_artists[0]?.entity_name)
    }
  ];
}
