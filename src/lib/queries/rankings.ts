import { supabase } from '$lib/supabase';
import { metricValue } from '$lib/metrics';
import type { CalendarDay, EntityType, Metric, RankingRow } from '$lib/types';

type RollupRow = {
  local_date: string;
  entity_id: string;
  entity_name: string;
  minutes_exact: number | string;
  minutes_inferred: number | string;
  plays: number;
  qualified_plays: number;
  unique_tracks: number;
  skipped_count: number | null;
  known_skip_count: number | null;
  unknown_duration_plays: number;
};

function numberValue(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

function aggregateRows(rows: RollupRow[]): RankingRow[] {
  const byEntity = new Map<string, RankingRow>();

  for (const row of rows) {
    const current =
      byEntity.get(row.entity_id) ??
      ({
        entity_id: row.entity_id,
        entity_name: row.entity_name,
        minutes: 0,
        plays: 0,
        qualified_plays: 0,
        unique_tracks: 0,
        skipped_count: 0,
        known_skip_count: 0,
        unknown_duration_plays: 0
      } satisfies RankingRow);

    current.minutes += numberValue(row.minutes_exact) + numberValue(row.minutes_inferred);
    current.plays += row.plays ?? 0;
    current.qualified_plays += row.qualified_plays ?? 0;
    current.unique_tracks += row.unique_tracks ?? 0;
    current.skipped_count += row.skipped_count ?? 0;
    current.known_skip_count += row.known_skip_count ?? 0;
    current.unknown_duration_plays += row.unknown_duration_plays ?? 0;
    byEntity.set(row.entity_id, current);
  }

  return [...byEntity.values()];
}

export async function getRankings(params: {
  entityType: EntityType;
  start: string;
  end: string;
  metric: Metric;
  limit?: number;
}): Promise<RankingRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('rollup_daily_entity_stats')
    .select(
      'local_date,entity_id,entity_name,minutes_exact,minutes_inferred,plays,qualified_plays,unique_tracks,skipped_count,known_skip_count,unknown_duration_plays'
    )
    .eq('entity_type', params.entityType)
    .gte('local_date', params.start)
    .lte('local_date', params.end)
    .limit(5000)
    .returns<RollupRow[]>();

  if (error) throw new Error(error.message);

  return aggregateRows(data ?? [])
    .sort((left, right) => metricValue(right, params.metric) - metricValue(left, params.metric))
    .slice(0, params.limit ?? 50);
}

export async function getProfileRankings(params: {
  slug: string;
  entityType: EntityType;
  start: string;
  end: string;
  metric: Metric;
  limit?: number;
}): Promise<RankingRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('public_profile_rollup_daily_entity_stats')
    .select(
      'local_date,entity_id,entity_name,minutes_exact,minutes_inferred,plays,qualified_plays,unique_tracks,skipped_count,known_skip_count,unknown_duration_plays'
    )
    .eq('slug', params.slug)
    .eq('entity_type', params.entityType)
    .gte('local_date', params.start)
    .lte('local_date', params.end)
    .limit(5000)
    .returns<RollupRow[]>();

  if (error) throw new Error(error.message);

  return aggregateRows(data ?? [])
    .sort((left, right) => metricValue(right, params.metric) - metricValue(left, params.metric))
    .slice(0, params.limit ?? 50);
}

export async function getEntityTimeline(params: {
  entityType: EntityType;
  entityId: string;
  start: string;
  end: string;
}): Promise<CalendarDay[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('rollup_daily_entity_stats')
    .select('local_date,minutes_exact,minutes_inferred,plays')
    .eq('entity_type', params.entityType)
    .eq('entity_id', params.entityId)
    .gte('local_date', params.start)
    .lte('local_date', params.end)
    .order('local_date', { ascending: true })
    .returns<Array<Pick<RollupRow, 'local_date' | 'minutes_exact' | 'minutes_inferred' | 'plays'>>>();

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    local_date: row.local_date,
    minutes: numberValue(row.minutes_exact) + numberValue(row.minutes_inferred),
    plays: row.plays
  }));
}

export async function getCalendar(start: string, end: string): Promise<CalendarDay[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('rollup_daily_entity_stats')
    .select('local_date,minutes_exact,minutes_inferred,plays')
    .eq('entity_type', 'artist')
    .gte('local_date', start)
    .lte('local_date', end)
    .order('local_date', { ascending: true })
    .limit(5000)
    .returns<Array<Pick<RollupRow, 'local_date' | 'minutes_exact' | 'minutes_inferred' | 'plays'>>>();

  if (error) throw new Error(error.message);

  const byDate = new Map<string, CalendarDay>();
  for (const row of data ?? []) {
    const current = byDate.get(row.local_date) ?? {
      local_date: row.local_date,
      minutes: 0,
      plays: 0
    };
    current.minutes += numberValue(row.minutes_exact) + numberValue(row.minutes_inferred);
    current.plays += row.plays;
    byDate.set(row.local_date, current);
  }

  return [...byDate.values()].sort((left, right) => left.local_date.localeCompare(right.local_date));
}
