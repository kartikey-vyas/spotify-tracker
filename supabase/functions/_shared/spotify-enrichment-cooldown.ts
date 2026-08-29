export type SpotifyRateCapRun = {
  aborted: boolean;
  started_at: string;
  abort_retry_after_seconds: number | null;
};

export function buildSpotifyCooldownRunRecord(
  batchSize: number,
  concurrency: number,
  remainingSeconds: number,
  recordedAt: string
): Record<string, unknown> {
  return {
    trigger: 'cron',
    requested_limit: batchSize,
    concurrency,
    worklist_size: 0,
    enriched: 0,
    missing: 0,
    failed: 0,
    aborted: true,
    abort_retry_after_seconds: remainingSeconds,
    // Use one Edge timestamp for both values. Postgres and an Edge isolate can
    // differ by milliseconds, so mixing database-default start with Edge finish
    // can otherwise produce a negative run duration.
    started_at: recordedAt,
    finished_at: recordedAt
  };
}

/**
 * Return the whole seconds still remaining on a persisted Spotify rate cap.
 * Ceiling avoids making a provider request during the final partial second.
 */
export function remainingSpotifyCooldownSeconds(
  run: SpotifyRateCapRun | null | undefined,
  nowMs = Date.now()
): number {
  if (!run?.aborted) return 0;
  const retryAfter = run.abort_retry_after_seconds;
  const startedAt = Date.parse(run.started_at);
  if (
    typeof retryAfter !== 'number' ||
    !Number.isFinite(retryAfter) ||
    retryAfter <= 0 ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(nowMs)
  ) {
    return 0;
  }

  return Math.max(0, Math.ceil((startedAt + retryAfter * 1000 - nowMs) / 1000));
}
