import type { OverviewPayload } from './types';

export type SyncDiagnosticsSource = 'admin' | 'public';

export type SyncDiagnosticsRow = {
  source: SyncDiagnosticsSource;
  user_id: string | null;
  slug: string | null;
  display_name: string;
  is_public: boolean | null;
  gap_risk: boolean;
  recently_played_cursor_ms: number | null;
  recently_played_last_success_at: string | null;
  recently_played_last_error_at: string | null;
  recently_played_last_error: string | null;
  latest_exact_export_event_at: string | null;
  api_only_period_start: string | null;
  updated_at: string | null;
};

export function publicOverviewToDiagnosticsRow(
  profile: { slug: string; display_name: string },
  overview: OverviewPayload
): SyncDiagnosticsRow {
  return {
    source: 'public',
    user_id: null,
    slug: profile.slug,
    display_name: profile.display_name,
    is_public: true,
    gap_risk: overview.sync.gap_risk,
    recently_played_cursor_ms: null,
    recently_played_last_success_at: overview.sync.last_success_at,
    recently_played_last_error_at: null,
    recently_played_last_error: null,
    latest_exact_export_event_at: overview.sync.latest_exact_export_event_at,
    api_only_period_start: overview.sync.api_only_period_start,
    updated_at: overview.generated_at
  };
}

export function gapWindowLabel(row: SyncDiagnosticsRow): string {
  if (!row.gap_risk) return 'No gap risk is currently flagged.';

  if (row.latest_exact_export_event_at && row.api_only_period_start) {
    const exactEnd = new Date(row.latest_exact_export_event_at).getTime();
    const apiStart = new Date(row.api_only_period_start).getTime();

    if (Number.isFinite(exactEnd) && Number.isFinite(apiStart) && apiStart > exactEnd) {
      return `Possible gap between exact export ending ${formatDateTime(row.latest_exact_export_event_at)} and API coverage starting ${formatDateTime(row.api_only_period_start)}.`;
    }

    return `Exact export reaches ${formatDateTime(row.latest_exact_export_event_at)}; API-only coverage starts ${formatDateTime(row.api_only_period_start)}. The stored ranges overlap, so the flag is likely historical or from a capped/missed API sync.`;
  }

  if (row.api_only_period_start) {
    return `Possible gap before first stored API-only play at ${formatDateTime(row.api_only_period_start)}.`;
  }

  if (row.recently_played_last_success_at) {
    return `Possible gap before or around the last successful API sync at ${formatDateTime(row.recently_played_last_success_at)}. The exact missed interval was not retained.`;
  }

  return 'Possible gap before the first successful API sync. No timestamp anchor is stored yet.';
}

export function gapReasonLabel(row: SyncDiagnosticsRow, now = new Date()): string {
  if (!row.gap_risk) return 'continuous';
  if (row.recently_played_last_error_at) {
    return `sync error at ${formatDateTime(row.recently_played_last_error_at)}`;
  }
  if (!row.recently_played_cursor_ms && row.source === 'admin') return 'no API cursor yet';
  if (row.recently_played_last_success_at) {
    const lastSuccessMs = new Date(row.recently_played_last_success_at).getTime();
    if (Number.isFinite(lastSuccessMs) && now.getTime() - lastSuccessMs > 24 * 60 * 60 * 1000) {
      return 'last API sync is over 24h old';
    }
  }
  return 'sticky historical flag';
}

export function formatDateTime(value: string | null): string {
  if (!value) return 'n/a';
  return new Date(value).toLocaleString();
}
