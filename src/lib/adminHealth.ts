export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'paused';

export type AdminSystemHealth = {
  total_profiles: number;
  public_profile_count: number;
  private_profile_count: number;
  connected_user_count: number;
  sync_enabled_user_count: number;
  stale_sync_user_count: number;
  sync_error_user_count: number;
  artist_count: number;
  album_count: number;
  track_count: number;
  tracks_missing_duration: number;
  albums_missing_image: number;
  artists_stale_or_unrefreshed: number;
  metadata_last_success_at: string | null;
  metadata_last_error_at: string | null;
  metadata_last_error: string | null;
  cron_job_active: boolean;
  cron_last_run_at: string | null;
  cron_last_status: string | null;
  cron_last_success_at: string | null;
  cron_recent_failures: number;
};

export type AdminUserHealth = {
  user_id: string;
  slug: string;
  display_name: string;
  is_public: boolean;
  onboarding_completed_at: string | null;
  onboarding_state: 'pending' | 'complete';
  spotify_connected: boolean;
  spotify_user_id: string | null;
  spotify_display_name: string | null;
  sync_enabled: boolean;
  connected_at: string | null;
  connection_last_error_at: string | null;
  connection_last_error: string | null;
  recently_played_last_success_at: string | null;
  recently_played_last_error_at: string | null;
  recently_played_last_error: string | null;
  recently_played_gap_risk: boolean;
  latest_exact_export_event_at: string | null;
  api_only_period_start: string | null;
  latest_stored_event_at: string | null;
  exact_play_count: number;
  api_play_count: number;
  total_play_count: number;
  overview_generated_at: string | null;
  latest_rollup_updated_at: string | null;
};

export type AdminDashboard = {
  system: AdminSystemHealth;
  users: AdminUserHealth[];
};

export const CRON_WARNING_MINUTES = 30;
export const USER_SYNC_CRITICAL_MINUTES = 60;

const minuteMs = 60 * 1000;

function timestampMs(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isOlderThan(value: string | null, minutes: number, now: Date): boolean {
  const ms = timestampMs(value);
  if (ms === null) return true;
  return now.getTime() - ms > minutes * minuteMs;
}

function hasActiveError(errorAt: string | null, successAt: string | null): boolean {
  const errorMs = timestampMs(errorAt);
  if (errorMs === null) return false;
  const successMs = timestampMs(successAt);
  return successMs === null || errorMs > successMs;
}

export function isUserSyncStale(user: AdminUserHealth, now = new Date()): boolean {
  if (!user.spotify_connected || !user.sync_enabled) return false;
  return isOlderThan(user.recently_played_last_success_at, USER_SYNC_CRITICAL_MINUTES, now);
}

export function classifyUserHealth(user: AdminUserHealth, now = new Date()): HealthStatus {
  if (!user.spotify_connected || !user.sync_enabled) return 'paused';
  if (isUserSyncStale(user, now)) return 'critical';
  if (
    hasActiveError(user.recently_played_last_error_at, user.recently_played_last_success_at) ||
    hasActiveError(user.connection_last_error_at, user.recently_played_last_success_at)
  ) {
    return 'warning';
  }
  return 'healthy';
}

export function classifySystemHealth(system: AdminSystemHealth, now = new Date()): HealthStatus {
  if (system.stale_sync_user_count > 0) return 'critical';
  if (!system.cron_job_active) return 'warning';
  if (system.cron_last_status && system.cron_last_status !== 'succeeded') return 'warning';
  if (isOlderThan(system.cron_last_success_at, CRON_WARNING_MINUTES, now)) return 'warning';
  if (system.sync_error_user_count > 0) return 'warning';
  if (hasActiveError(system.metadata_last_error_at, system.metadata_last_success_at)) return 'warning';
  return 'healthy';
}

export function formatCount(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString();
}

export function formatDateTime(value: string | null): string {
  if (!value) return 'n/a';
  return new Date(value).toLocaleString();
}

export function formatRelativeAge(value: string | null, now = new Date()): string {
  const ms = timestampMs(value);
  if (ms === null) return 'n/a';

  const deltaMs = now.getTime() - ms;
  const absMinutes = Math.max(0, Math.round(Math.abs(deltaMs) / minuteMs));
  const suffix = deltaMs >= 0 ? 'ago' : 'from now';

  if (absMinutes < 60) return `${absMinutes}m ${suffix}`;

  const hours = Math.round(absMinutes / 60);
  if (hours < 48) return `${hours}h ${suffix}`;

  const days = Math.round(hours / 24);
  return `${days}d ${suffix}`;
}

export function statusClass(status: HealthStatus): string {
  return `status ${status}`;
}

export function userErrorLabel(user: AdminUserHealth): string | null {
  return user.recently_played_last_error ?? user.connection_last_error ?? null;
}

export function cronFreshnessLabel(system: AdminSystemHealth, now = new Date()): string {
  if (!system.cron_job_active) return 'cron inactive';
  if (!system.cron_last_run_at) return 'no run recorded';
  const status = system.cron_last_status ?? 'unknown';
  return `${status}, ${formatRelativeAge(system.cron_last_run_at, now)}`;
}

export function syncFreshnessLabel(user: AdminUserHealth, now = new Date()): string {
  if (!user.spotify_connected) return 'not connected';
  if (!user.sync_enabled) return 'paused';
  if (!user.recently_played_last_success_at) return 'never synced';
  return formatRelativeAge(user.recently_played_last_success_at, now);
}

export function latestPlayLabel(user: AdminUserHealth, now = new Date()): string {
  if (!user.latest_stored_event_at) return 'none stored';
  return formatRelativeAge(user.latest_stored_event_at, now);
}

export function coverageLabel(user: Pick<AdminUserHealth, 'exact_play_count' | 'api_play_count'>): string {
  return `${formatCount(user.exact_play_count)} exact / ${formatCount(user.api_play_count)} API`;
}

export function visibilityLabel(user: Pick<AdminUserHealth, 'is_public' | 'onboarding_state'>): string {
  const visibility = user.is_public ? 'public' : 'private';
  return user.onboarding_state === 'complete' ? visibility : `${visibility}, onboarding pending`;
}

export function overviewFreshnessLabel(user: AdminUserHealth, now = new Date()): string {
  if (!user.overview_generated_at) return 'missing';
  return formatRelativeAge(user.overview_generated_at, now);
}

export function gapDiagnosticLabel(user: AdminUserHealth): string {
  if (!user.recently_played_gap_risk) return 'none';

  if (user.latest_exact_export_event_at && user.api_only_period_start) {
    const exactEnd = timestampMs(user.latest_exact_export_event_at);
    const apiStart = timestampMs(user.api_only_period_start);

    if (exactEnd !== null && apiStart !== null && apiStart > exactEnd) {
      return 'possible export/API gap';
    }
  }

  if (user.recently_played_last_error_at) return 'flagged after sync error';
  return 'historical flag';
}

export function catalogTotalsLabel(system: AdminSystemHealth): string {
  return `${formatCount(system.track_count)} tracks / ${formatCount(system.album_count)} albums / ${formatCount(system.artist_count)} artists`;
}
