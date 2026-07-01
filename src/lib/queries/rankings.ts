import { supabase } from '$lib/supabase';
import { metricValue } from '$lib/metrics';
import type { ArtistDetail, CalendarDay, EntityType, Metric, MonthlyTimelineBucket, ProfileDateSpan, RankingRow } from '$lib/types';

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

type RpcRankingRow = {
  entity_id: string;
  entity_name: string;
  minutes: number | string;
  plays: number;
  qualified_plays: number;
  unique_tracks: number;
  skipped_count: number | null;
  known_skip_count: number | null;
  unknown_duration_plays: number;
};

type RpcMonthlyTimelineRow = {
  month_start: string;
  minutes: number | string;
  plays: number;
  qualified_plays: number;
  unique_tracks: number;
  skipped_count: number | null;
  known_skip_count: number | null;
  unknown_duration_plays: number;
};

// Daily rollup rows are aggregated client-side across the date range, so long
// windows must be paged instead of capped at one PostgREST response.
const ROLLUP_PAGE_SIZE = 1000;

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

function mapRpcRankingRow(row: RpcRankingRow): RankingRow {
  return {
    entity_id: row.entity_id,
    entity_name: row.entity_name,
    minutes: numberValue(row.minutes),
    plays: row.plays ?? 0,
    qualified_plays: row.qualified_plays ?? 0,
    unique_tracks: row.unique_tracks ?? 0,
    skipped_count: row.skipped_count ?? 0,
    known_skip_count: row.known_skip_count ?? 0,
    unknown_duration_plays: row.unknown_duration_plays ?? 0
  };
}

function mapRpcMonthlyRow(row: RpcMonthlyTimelineRow): MonthlyTimelineBucket {
  return {
    month_start: row.month_start,
    minutes: numberValue(row.minutes),
    plays: row.plays ?? 0,
    qualified_plays: row.qualified_plays ?? 0,
    unique_tracks: row.unique_tracks ?? 0,
    skipped_count: row.skipped_count ?? 0,
    known_skip_count: row.known_skip_count ?? 0,
    unknown_duration_plays: row.unknown_duration_plays ?? 0
  };
}

export async function getRankings(params: {
  entityType: EntityType;
  start: string;
  end: string;
  metric: Metric;
  limit?: number;
}): Promise<RankingRow[]> {
  if (!supabase) return [];

  const data: RollupRow[] = [];
  for (let from = 0; ; from += ROLLUP_PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from('rollup_daily_entity_stats')
      .select(
        'local_date,entity_id,entity_name,minutes_exact,minutes_inferred,plays,qualified_plays,unique_tracks,skipped_count,known_skip_count,unknown_duration_plays'
      )
      .eq('entity_type', params.entityType)
      .gte('local_date', params.start)
      .lte('local_date', params.end)
      .order('local_date', { ascending: true })
      .order('entity_id', { ascending: true })
      .range(from, from + ROLLUP_PAGE_SIZE - 1)
      .returns<RollupRow[]>();

    if (error) throw new Error(error.message);
    data.push(...(page ?? []));
    if (!page || page.length < ROLLUP_PAGE_SIZE) break;
  }

  return aggregateRows(data)
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

  const data: RollupRow[] = [];
  for (let from = 0; ; from += ROLLUP_PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from('public_profile_rollup_daily_entity_stats')
      .select(
        'local_date,entity_id,entity_name,minutes_exact,minutes_inferred,plays,qualified_plays,unique_tracks,skipped_count,known_skip_count,unknown_duration_plays'
      )
      .eq('slug', params.slug)
      .eq('entity_type', params.entityType)
      .gte('local_date', params.start)
      .lte('local_date', params.end)
      .order('local_date', { ascending: true })
      .order('entity_id', { ascending: true })
      .range(from, from + ROLLUP_PAGE_SIZE - 1)
      .returns<RollupRow[]>();

    if (error) throw new Error(error.message);
    data.push(...(page ?? []));
    if (!page || page.length < ROLLUP_PAGE_SIZE) break;
  }

  return aggregateRows(data)
    .sort((left, right) => metricValue(right, params.metric) - metricValue(left, params.metric))
    .slice(0, params.limit ?? 50);
}

export async function getProfileDateSpan(slug: string): Promise<ProfileDateSpan | null> {
  if (!supabase) return null;

  const [firstResult, lastResult] = await Promise.all([
    supabase
      .from('public_profile_rollup_daily_entity_stats')
      .select('local_date')
      .eq('slug', slug)
      .order('local_date', { ascending: true })
      .limit(1)
      .returns<Array<{ local_date: string }>>(),
    supabase
      .from('public_profile_rollup_daily_entity_stats')
      .select('local_date')
      .eq('slug', slug)
      .order('local_date', { ascending: false })
      .limit(1)
      .returns<Array<{ local_date: string }>>()
  ]);

  if (firstResult.error) throw new Error(firstResult.error.message);
  if (lastResult.error) throw new Error(lastResult.error.message);

  const start = firstResult.data?.[0]?.local_date;
  const end = lastResult.data?.[0]?.local_date;
  return start && end ? { start, end } : null;
}

export async function getProfileArtistDetail(params: {
  slug: string;
  artistId: string;
  start: string;
  end: string;
  metric: Metric;
  limit?: number;
}): Promise<ArtistDetail> {
  const empty: ArtistDetail = { summary: null, albums: [], tracks: [], monthly: [] };
  if (!supabase) return empty;

  const numericArtistId = Number(params.artistId);
  if (!Number.isInteger(numericArtistId) || numericArtistId <= 0) return empty;

  const baseArgs = {
    p_slug: params.slug,
    p_artist_id: numericArtistId,
    p_start_date: params.start,
    p_end_date: params.end
  };
  const rankedArgs = {
    ...baseArgs,
    p_sort_metric: params.metric,
    p_limit: params.limit ?? 12
  };

  const [summaryResult, albumsResult, tracksResult, monthlyResult] = await Promise.all([
    supabase.rpc('public_profile_artist_summary', baseArgs).returns<RpcRankingRow[]>(),
    supabase.rpc('public_profile_artist_top_albums', rankedArgs).returns<RpcRankingRow[]>(),
    supabase.rpc('public_profile_artist_top_tracks', rankedArgs).returns<RpcRankingRow[]>(),
    supabase.rpc('public_profile_artist_monthly_timeline', baseArgs).returns<RpcMonthlyTimelineRow[]>()
  ]);

  if (summaryResult.error) throw new Error(summaryResult.error.message);
  if (albumsResult.error) throw new Error(albumsResult.error.message);
  if (tracksResult.error) throw new Error(tracksResult.error.message);
  if (monthlyResult.error) throw new Error(monthlyResult.error.message);

  const summaryRows = (summaryResult.data ?? []) as unknown as RpcRankingRow[];
  const albumRows = (albumsResult.data ?? []) as unknown as RpcRankingRow[];
  const trackRows = (tracksResult.data ?? []) as unknown as RpcRankingRow[];
  const monthlyRows = (monthlyResult.data ?? []) as unknown as RpcMonthlyTimelineRow[];

  return {
    summary: summaryRows[0] ? mapRpcRankingRow(summaryRows[0]) : null,
    albums: albumRows.map(mapRpcRankingRow),
    tracks: trackRows.map(mapRpcRankingRow),
    monthly: monthlyRows.map(mapRpcMonthlyRow)
  };
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

  const data: Array<Pick<RollupRow, 'local_date' | 'minutes_exact' | 'minutes_inferred' | 'plays'>> = [];
  for (let from = 0; ; from += ROLLUP_PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from('rollup_daily_entity_stats')
      .select('local_date,minutes_exact,minutes_inferred,plays')
      .eq('entity_type', 'artist')
      .gte('local_date', start)
      .lte('local_date', end)
      .order('local_date', { ascending: true })
      .order('entity_id', { ascending: true })
      .range(from, from + ROLLUP_PAGE_SIZE - 1)
      .returns<Array<Pick<RollupRow, 'local_date' | 'minutes_exact' | 'minutes_inferred' | 'plays'>>>();

    if (error) throw new Error(error.message);
    data.push(...(page ?? []));
    if (!page || page.length < ROLLUP_PAGE_SIZE) break;
  }

  const byDate = new Map<string, CalendarDay>();
  for (const row of data) {
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
