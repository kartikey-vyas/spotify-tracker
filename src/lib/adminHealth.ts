export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'paused' | 'deferred';

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
  tracks_enriched: number;
  tracks_unenriched: number;
  tracks_missing_duration: number;
  albums_missing_image: number;
  albums_referenced_by_tracks: number;
  referenced_albums_missing_image: number;
  active_listening_event_count: number;
  active_events_missing_album_image: number;
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

export type AdminEnrichmentRun = {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  requested_limit: number | null;
  concurrency: number;
  worklist_size: number | null;
  enriched: number;
  missing: number;
  failed: number;
  aborted: boolean;
  abort_retry_after_seconds: number | null;
  error: string | null;
  duration_seconds: number | null;
};

export type AdminDashboard = {
  system: AdminSystemHealth;
  users: AdminUserHealth[];
  enrichmentRuns: AdminEnrichmentRun[];
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

export type EnrichmentProgress = {
  enriched: number;
  remaining: number;
  total: number;
  percent: number;
};

/**
 * Progress of `pnpm enrich:backfill` over the tracks it can actually work on.
 * The denominator is tracks with a Spotify id, matching the script's worklist —
 * a track without one is unreachable, not pending.
 */
export function enrichmentProgress(
  system: Pick<AdminSystemHealth, 'tracks_enriched' | 'tracks_unenriched'>
): EnrichmentProgress {
  const enriched = Math.max(0, system.tracks_enriched ?? 0);
  const remaining = Math.max(0, system.tracks_unenriched ?? 0);
  const total = enriched + remaining;
  return {
    enriched,
    remaining,
    total,
    percent: total === 0 ? 0 : (enriched / total) * 100
  };
}

export function enrichmentProgressLabel(
  system: Pick<AdminSystemHealth, 'tracks_enriched' | 'tracks_unenriched'>
): string {
  const { enriched, total, percent } = enrichmentProgress(system);
  if (total === 0) return 'no enrichable tracks';
  return `${formatCount(enriched)} / ${formatCount(total)} (${percent.toFixed(1)}%)`;
}

export type ArtworkCoverage = {
  covered: number;
  total: number;
  missing: number;
  percent: number;
};

/** Coverage over a meaningful population such as referenced albums or plays. */
export function artworkCoverage(totalValue: number, missingValue: number): ArtworkCoverage {
  const total = Math.max(0, totalValue ?? 0);
  const missing = Math.min(total, Math.max(0, missingValue ?? 0));
  const covered = total - missing;
  return {
    covered,
    total,
    missing,
    percent: total === 0 ? 0 : (covered / total) * 100
  };
}

export function artworkCoverageLabel(total: number, missing: number): string {
  const coverage = artworkCoverage(total, missing);
  if (coverage.total === 0) return 'no coverage data';
  return `${formatCount(coverage.covered)} / ${formatCount(coverage.total)} (${coverage.percent.toFixed(1)}%)`;
}

/** Tracks enriched across every run that started within the trailing window. */
export function enrichedInWindow(runs: AdminEnrichmentRun[], hours: number, now = new Date()): number {
  const cutoff = now.getTime() - hours * 60 * minuteMs;
  return runs.reduce((total, run) => {
    const started = timestampMs(run.started_at);
    if (started === null || started < cutoff) return total;
    return total + Math.max(0, run.enriched);
  }, 0);
}

/**
 * Days to drain `remaining` at the observed 24h rate. Null when nothing has
 * been enriched in the window — a rate of zero projects to infinity, which is
 * not a useful thing to render.
 */
export function projectedDaysRemaining(remaining: number, perDay: number): number | null {
  if (remaining <= 0) return 0;
  if (perDay <= 0) return null;
  return remaining / perDay;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return 'n/a';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const leftoverMinutes = minutes % 60;
  if (hours < 24) return leftoverMinutes === 0 ? `${hours}h` : `${hours}h ${leftoverMinutes}m`;
  const days = Math.floor(hours / 24);
  const leftoverHours = hours % 24;
  return leftoverHours === 0 ? `${days}d` : `${days}d ${leftoverHours}h`;
}

/** One-line outcome for a run row: what it achieved, or why it stopped. */
export function runOutcomeLabel(run: AdminEnrichmentRun): string {
  if (isDeferredRun(run)) {
    const retry = run.abort_retry_after_seconds;
    const wait = retry === null ? '' : `, retry-after ${formatDuration(retry)}`;
    return `deferred by Spotify cooldown${wait}`;
  }
  if (run.aborted) {
    const retry = run.abort_retry_after_seconds;
    const wait = retry === null ? '' : `, retry-after ${formatDuration(retry)}`;
    return `rate capped after ${formatCount(run.enriched)}${wait}`;
  }
  if (run.finished_at === null) return `unfinished (${formatCount(run.enriched)} enriched)`;
  const parts = [`${formatCount(run.enriched)} enriched`];
  if (run.missing > 0) parts.push(`${formatCount(run.missing)} missing`);
  if (run.failed > 0) parts.push(`${formatCount(run.failed)} failed`);
  return parts.join(', ');
}

/** A cooldown row records no attempted work and should not read as a failure. */
export function isDeferredRun(run: AdminEnrichmentRun): boolean {
  return (
    run.aborted &&
    run.worklist_size === 0 &&
    run.enriched === 0 &&
    run.missing === 0 &&
    run.failed === 0 &&
    run.abort_retry_after_seconds !== null
  );
}

export function runStatus(run: AdminEnrichmentRun): HealthStatus {
  if (isDeferredRun(run)) return 'deferred';
  if (run.aborted) return 'warning';
  if (run.finished_at === null) return 'critical';
  if (run.failed > 0) return 'warning';
  return 'healthy';
}

/**
 * When Spotify's cap is expected to lift, derived from the most recent aborted
 * run's retry-after. Null when no run has been capped or the header was absent.
 */
export function capResetAt(runs: AdminEnrichmentRun[]): Date | null {
  const capped = runs.find((run) => run.aborted && run.abort_retry_after_seconds !== null);
  if (!capped) return null;
  const started = timestampMs(capped.finished_at ?? capped.started_at);
  if (started === null) return null;
  return new Date(started + (capped.abort_retry_after_seconds ?? 0) * 1000);
}

/**
 * Whether a cap is still in force. Without the time check the last abort's
 * reset time would render forever, receding further into the past each day.
 */
export function isCapPending(runs: AdminEnrichmentRun[], now = new Date()): boolean {
  const resetAt = capResetAt(runs);
  return resetAt !== null && resetAt.getTime() > now.getTime();
}
