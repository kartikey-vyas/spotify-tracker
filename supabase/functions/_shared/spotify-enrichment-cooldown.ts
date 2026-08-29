export type SpotifyRateCapRun = {
  aborted: boolean;
  started_at: string;
  abort_retry_after_seconds: number | null;
};

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
