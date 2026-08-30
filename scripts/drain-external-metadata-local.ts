import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServiceClient, throwIfSupabaseError, type AdminClient } from './lib/supabase-admin.js';
import { optionalEnv, requireEnv } from './lib/env.js';
import { previousResult } from '../supabase/functions/_shared/external-music-enrichment.ts';
import type { ExternalMusicWorkItem } from '../supabase/functions/_shared/external-music-persistence.ts';
import {
  DEFAULT_MUSICBRAINZ_USER_AGENT,
  ProviderPacer,
  processExternalMusicItem,
  type ExternalMusicItemOutcome,
  type ExternalMusicProviderCircuit
} from '../supabase/functions/_shared/external-music-worker.ts';

const DEFAULT_DURATION_HOURS = 12;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_LEASE_SECONDS = 600;
const DEFAULT_REQUEST_INTERVAL_MS = 1_100;
const DEFAULT_IDLE_SECONDS = 15;
const DEFAULT_MAX_ROLLUP_BACKLOG = 500;
const DEFAULT_MAX_RSS_MB = 512;
const DEFAULT_MEMORY_SAMPLE_SECONDS = 60;

type RunnerOptions = {
  durationHours: number;
  batchSize: number;
  leaseSeconds: number;
  requestIntervalMs: number;
  idleSeconds: number;
  maxRollupBacklog: number;
  maxRssMb: number;
  memorySampleSeconds: number;
  maxBatches: number;
};

export type MemorySnapshot = {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  arrayBuffersMb: number;
};

type ProviderName = keyof ExternalMusicProviderCircuit;
export type ProviderCircuitExpiries = Record<ProviderName, number | null>;

type BatchCounts = {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
  warnings: number;
};

type BatchResult = {
  runId: number | null;
  busyOrEmpty: boolean;
  counts: BatchCounts;
  progress: unknown[];
};

function numericFlag(argv: string[], name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
}

function boundedNumber(value: number | undefined, fallback: number, minimum: number, maximum: number, name: string) {
  const resolved = value ?? fallback;
  if (resolved < minimum || resolved > maximum) {
    throw new Error(`--${name} must be between ${minimum} and ${maximum}`);
  }
  return resolved;
}

export function shouldApplyRollupBackpressure(pendingRollups: number, maxRollupBacklog: number): boolean {
  return pendingRollups >= maxRollupBacklog;
}

function bytesToMb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024 * 10) / 10;
}

export function memorySnapshot(usage: NodeJS.MemoryUsage = process.memoryUsage()): MemorySnapshot {
  return {
    rssMb: bytesToMb(usage.rss),
    heapUsedMb: bytesToMb(usage.heapUsed),
    heapTotalMb: bytesToMb(usage.heapTotal),
    externalMb: bytesToMb(usage.external),
    arrayBuffersMb: bytesToMb(usage.arrayBuffers)
  };
}

export function shouldRecycleForMemory(snapshot: MemorySnapshot, maxRssMb: number): boolean {
  return snapshot.rssMb >= maxRssMb;
}

export function expireProviderCircuits(
  circuit: ExternalMusicProviderCircuit,
  expiresAt: ProviderCircuitExpiries,
  now = Date.now()
): ProviderName[] {
  const closed: ProviderName[] = [];
  for (const provider of ['musicbrainz', 'lastfm'] as const) {
    if (circuit[provider] && expiresAt[provider] !== null && expiresAt[provider]! <= now) {
      circuit[provider] = null;
      expiresAt[provider] = null;
      closed.push(provider);
    }
  }
  return closed;
}

export function captureProviderCircuitCooldowns(
  circuit: ExternalMusicProviderCircuit,
  expiresAt: ProviderCircuitExpiries,
  now = Date.now()
): Array<{ provider: ProviderName; retryAfterSeconds: number; retryAt: number; message: string | null }> {
  const opened: Array<{
    provider: ProviderName;
    retryAfterSeconds: number;
    retryAt: number;
    message: string | null;
  }> = [];
  for (const provider of ['musicbrainz', 'lastfm'] as const) {
    const decision = circuit[provider];
    if (!decision || expiresAt[provider] !== null) continue;
    const retryAfterSeconds = Math.max(1, decision.retryAfterSeconds ?? 60);
    const retryAt = now + retryAfterSeconds * 1_000;
    expiresAt[provider] = retryAt;
    opened.push({
      provider,
      retryAfterSeconds,
      retryAt,
      message: decision.message ?? null
    });
  }
  return opened;
}

export function parseRunnerOptions(argv: string[]): RunnerOptions {
  const once = argv.includes('--once');
  const unknown = argv.filter((value) =>
    value !== '--once' &&
    ![
      'duration-hours',
      'batch-size',
      'lease-seconds',
      'request-interval-ms',
      'idle-seconds',
      'max-rollup-backlog',
      'max-rss-mb',
      'memory-sample-seconds',
      'max-batches'
    ].some((name) => value.startsWith(`--${name}=`))
  );
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);

  const durationHours = boundedNumber(
    numericFlag(argv, 'duration-hours'),
    DEFAULT_DURATION_HOURS,
    1 / 3_600,
    168,
    'duration-hours'
  );
  const batchSize = Math.trunc(boundedNumber(
    numericFlag(argv, 'batch-size'),
    DEFAULT_BATCH_SIZE,
    1,
    20,
    'batch-size'
  ));
  const leaseSeconds = Math.trunc(boundedNumber(
    numericFlag(argv, 'lease-seconds'),
    DEFAULT_LEASE_SECONDS,
    60,
    600,
    'lease-seconds'
  ));
  // A minimum of 1,000ms enforces at most one outbound provider request per
  // second across MusicBrainz and Last.fm, not merely per provider.
  const requestIntervalMs = Math.trunc(boundedNumber(
    numericFlag(argv, 'request-interval-ms'),
    DEFAULT_REQUEST_INTERVAL_MS,
    1_000,
    60_000,
    'request-interval-ms'
  ));
  const idleSeconds = Math.trunc(boundedNumber(
    numericFlag(argv, 'idle-seconds'),
    DEFAULT_IDLE_SECONDS,
    1,
    300,
    'idle-seconds'
  ));
  const maxRollupBacklog = Math.trunc(boundedNumber(
    numericFlag(argv, 'max-rollup-backlog'),
    DEFAULT_MAX_ROLLUP_BACKLOG,
    1,
    100_000,
    'max-rollup-backlog'
  ));
  const maxRssMb = Math.trunc(boundedNumber(
    numericFlag(argv, 'max-rss-mb'),
    DEFAULT_MAX_RSS_MB,
    64,
    16_384,
    'max-rss-mb'
  ));
  const memorySampleSeconds = Math.trunc(boundedNumber(
    numericFlag(argv, 'memory-sample-seconds'),
    DEFAULT_MEMORY_SAMPLE_SECONDS,
    10,
    3_600,
    'memory-sample-seconds'
  ));
  const configuredMaxBatches = numericFlag(argv, 'max-batches');
  const maxBatches = once
    ? 1
    : configuredMaxBatches === undefined
      ? Number.POSITIVE_INFINITY
      : Math.trunc(boundedNumber(configuredMaxBatches, 1, 1, 1_000_000, 'max-batches'));

  return {
    durationHours,
    batchSize,
    leaseSeconds,
    requestIntervalMs,
    idleSeconds,
    maxRollupBacklog,
    maxRssMb,
    memorySampleSeconds,
    maxBatches
  };
}

function log(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }));
}

async function interruptibleSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  try {
    await sleep(milliseconds, undefined, { signal });
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  }
}

async function progress(supabase: AdminClient): Promise<unknown[]> {
  const { data, error } = await supabase.rpc('external_music_enrichment_progress');
  throwIfSupabaseError(error, 'Loading external enrichment progress failed');
  return data ?? [];
}

async function rollupBacklog(supabase: AdminClient): Promise<number> {
  const { count, error } = await supabase
    .from('rollup_refresh_queue')
    .select('user_id', { count: 'exact', head: true });
  throwIfSupabaseError(error, 'Loading rollup refresh backlog failed');
  return count ?? 0;
}

async function reconcileAbandonedRunTelemetry(
  supabase: AdminClient,
  leaseSeconds: number
): Promise<number[]> {
  const cutoff = new Date(Date.now() - (leaseSeconds + 60) * 1_000).toISOString();
  const { data: staleRows, error: selectError } = await supabase
    .from('external_music_enrichment_runs')
    .select('id')
    .is('finished_at', null)
    .lt('started_at', cutoff)
    .limit(100);
  throwIfSupabaseError(selectError, 'Loading abandoned enrichment telemetry failed');
  const ids = (staleRows ?? []).map((row) => (row as { id: number }).id);
  if (ids.length === 0) return [];

  const { error: updateError } = await supabase
    .from('external_music_enrichment_runs')
    .update({
      finished_at: new Date().toISOString(),
      warnings: 1,
      error: 'Worker exited before telemetry finalization; queue lease recovery applies'
    })
    .in('id', ids)
    .is('finished_at', null);
  throwIfSupabaseError(updateError, 'Reconciling abandoned enrichment telemetry failed');
  return ids;
}

async function runBatch(
  supabase: AdminClient,
  options: RunnerOptions,
  providerPacer: ProviderPacer,
  lastFmApiKey: string,
  musicBrainzUserAgent: string,
  circuit: ExternalMusicProviderCircuit
): Promise<BatchResult> {
  let workerToken: string | null = null;
  let runId: number | null = null;
  let runError: string | null = null;
  const counts: BatchCounts = { claimed: 0, succeeded: 0, retried: 0, dead: 0, warnings: 0 };

  try {
    const { data: claimedRows, error: claimError } = await supabase.rpc('claim_external_music_enrichment_batch', {
      p_batch_size: options.batchSize,
      p_lease_seconds: options.leaseSeconds
    });
    throwIfSupabaseError(claimError, 'Claiming external enrichment work failed');
    const items = (claimedRows ?? []) as ExternalMusicWorkItem[];
    if (items.length === 0) {
      return { runId, busyOrEmpty: true, counts, progress: await progress(supabase) };
    }

    workerToken = items[0].worker_token;
    counts.claimed = items.length;
    const { data: runRow, error: runInsertError } = await supabase
      .from('external_music_enrichment_runs')
      .insert({ requested_limit: options.batchSize, claimed: items.length })
      .select('id')
      .single();
    if (runInsertError) {
      counts.warnings += 1;
      log('run-telemetry-insert-warning', { error: runInsertError.message });
    }
    runId = (runRow as { id: number } | null)?.id ?? null;

    for (const item of items) {
      let outcome: ExternalMusicItemOutcome;
      try {
        // Both arguments deliberately share one pacer. The laptop runner is
        // capped globally at one outbound provider request per interval.
        outcome = await processExternalMusicItem(
          supabase,
          item,
          lastFmApiKey,
          musicBrainzUserAgent,
          providerPacer,
          providerPacer,
          circuit
        );
      } catch (error) {
        outcome = {
          result: previousResult(item.last_result),
          succeeded: false,
          error: error instanceof Error ? error.message : String(error),
          retryAfterSeconds: 300,
          consumeAttempt: true,
          warnings: 1
        };
      }

      const { data: finishStatus, error: finishError } = await supabase.rpc(
        'finish_external_music_enrichment_item',
        {
          p_queue_id: item.queue_id,
          p_worker_token: item.worker_token,
          p_succeeded: outcome.succeeded,
          p_error: outcome.error,
          p_retry_after_seconds: outcome.retryAfterSeconds,
          p_result: outcome.result,
          p_consume_attempt: outcome.consumeAttempt
        }
      );
      if (finishError) {
        counts.warnings += 1;
        log('finish-item-warning', { queueId: item.queue_id, error: finishError.message });
      } else if (finishStatus === 'succeeded') {
        counts.succeeded += 1;
      } else if (finishStatus === 'dead') {
        counts.dead += 1;
      } else {
        counts.retried += 1;
      }
      counts.warnings += outcome.warnings;
    }

    return { runId, busyOrEmpty: false, counts, progress: await progress(supabase) };
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (workerToken) {
      const { error } = await supabase.rpc('release_external_music_enrichment_worker', {
        p_worker_token: workerToken
      });
      if (error) log('release-worker-warning', { error: error.message });
    }
    if (runId !== null) {
      const { error } = await supabase
        .from('external_music_enrichment_runs')
        .update({
          finished_at: new Date().toISOString(),
          succeeded: counts.succeeded,
          retried: counts.retried,
          dead: counts.dead,
          warnings: counts.warnings,
          error: runError
        })
        .eq('id', runId);
      if (error) log('run-telemetry-finish-warning', { runId, error: error.message });
    }
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseRunnerOptions(argv);
  const supabase = createServiceClient();
  const lastFmApiKey = requireEnv('LASTFM_API_KEY');
  const musicBrainzUserAgent = optionalEnv('MUSICBRAINZ_USER_AGENT') ?? DEFAULT_MUSICBRAINZ_USER_AGENT;
  const deadline = Date.now() + options.durationHours * 60 * 60 * 1_000;
  const providerPacer = new ProviderPacer(options.requestIntervalMs);
  const providerCircuit: ExternalMusicProviderCircuit = { musicbrainz: null, lastfm: null };
  const providerCircuitExpiresAt: ProviderCircuitExpiries = { musicbrainz: null, lastfm: null };
  let stopping = false;
  let memoryLimitReached = false;
  let memoryLimitLogged = false;
  let batches = 0;
  let consecutiveErrors = 0;
  const exitController = new AbortController();

  const requestStop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    exitController.abort();
    log('stop-requested', { signal, message: 'Finishing the current claimed batch before exit' });
  };
  // A terminal signal can reach the worker directly and then be forwarded by
  // the supervisor. Keep these listeners installed so the duplicate remains
  // idempotent instead of falling through to Node's default immediate exit.
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);

  const reconciledRunIds = await reconcileAbandonedRunTelemetry(supabase, options.leaseSeconds);
  if (reconciledRunIds.length > 0) {
    log('abandoned-run-telemetry-reconciled', { runIds: reconciledRunIds });
  }

  log('runner-started', {
    deadline: new Date(deadline).toISOString(),
    batchSize: options.batchSize,
    leaseSeconds: options.leaseSeconds,
    requestIntervalMs: options.requestIntervalMs,
    maxRollupBacklog: options.maxRollupBacklog,
    maxRssMb: options.maxRssMb,
    memorySampleSeconds: options.memorySampleSeconds,
    maxBatches: Number.isFinite(options.maxBatches) ? options.maxBatches : null
  });

  const sampleMemory = (phase: 'startup' | 'interval' | 'after-batch') => {
    const snapshot = memorySnapshot();
    log('memory-snapshot', {
      phase,
      pid: process.pid,
      batch: batches,
      uptimeSeconds: Math.round(process.uptime()),
      ...snapshot
    });
    if (!memoryLimitLogged && shouldRecycleForMemory(snapshot, options.maxRssMb)) {
      memoryLimitReached = true;
      memoryLimitLogged = true;
      exitController.abort();
      log('memory-limit-recycle-requested', {
        pid: process.pid,
        rssMb: snapshot.rssMb,
        maxRssMb: options.maxRssMb,
        message: 'Finishing the current claimed batch before exit'
      });
    }
  };
  sampleMemory('startup');
  const memoryTimer = setInterval(() => sampleMemory('interval'), options.memorySampleSeconds * 1_000);
  memoryTimer.unref();

  try {
    while (
      !stopping &&
      !memoryLimitReached &&
      Date.now() < deadline &&
      batches < options.maxBatches
    ) {
      try {
        for (const provider of expireProviderCircuits(providerCircuit, providerCircuitExpiresAt)) {
          log('provider-circuit-half-open', { provider, message: 'Allowing one provider probe' });
        }
        if (providerCircuit.musicbrainz && providerCircuit.lastfm) {
          const retryAt = Math.min(
            providerCircuitExpiresAt.musicbrainz ?? Number.POSITIVE_INFINITY,
            providerCircuitExpiresAt.lastfm ?? Number.POSITIVE_INFINITY
          );
          const sleepMilliseconds = Math.max(1_000, retryAt - Date.now());
          log('all-provider-circuits-open', {
            sleepMilliseconds,
            message: 'Waiting for the first provider cooldown before claiming more work'
          });
          await interruptibleSleep(sleepMilliseconds, exitController.signal);
          continue;
        }
        const pendingRollups = await rollupBacklog(supabase);
        if (shouldApplyRollupBackpressure(pendingRollups, options.maxRollupBacklog)) {
          log('rollup-backpressure', {
            pendingRollups,
            maxRollupBacklog: options.maxRollupBacklog,
            sleepSeconds: options.idleSeconds
          });
          await interruptibleSleep(options.idleSeconds * 1_000, exitController.signal);
          continue;
        }
        const result = await runBatch(
          supabase,
          options,
          providerPacer,
          lastFmApiKey,
          musicBrainzUserAgent,
          providerCircuit
        );
        for (const opened of captureProviderCircuitCooldowns(
          providerCircuit,
          providerCircuitExpiresAt
        )) {
          log('provider-circuit-opened', {
            provider: opened.provider,
            retryAfterSeconds: opened.retryAfterSeconds,
            retryAt: new Date(opened.retryAt).toISOString(),
            message: opened.message
          });
        }
        consecutiveErrors = 0;
        if (result.busyOrEmpty) {
          log('queue-busy-or-empty', { rollupBacklog: pendingRollups, progress: result.progress });
          await interruptibleSleep(options.idleSeconds * 1_000, exitController.signal);
          continue;
        }
        batches += 1;
        log('batch-finished', {
          runId: result.runId,
          batch: batches,
          rollupBacklog: pendingRollups,
          ...result.counts,
          progress: result.progress
        });
        sampleMemory('after-batch');
      } catch (error) {
        consecutiveErrors += 1;
        const backoffSeconds = Math.min(300, 5 * 2 ** Math.min(consecutiveErrors - 1, 6));
        log('batch-error', {
          consecutiveErrors,
          backoffSeconds,
          error: error instanceof Error ? error.message : String(error)
        });
        await interruptibleSleep(backoffSeconds * 1_000, exitController.signal);
      }
    }
  } finally {
    clearInterval(memoryTimer);
  }

  log('runner-finished', {
    reason: stopping
      ? 'signal'
      : memoryLimitReached
        ? 'memory-limit'
        : batches >= options.maxBatches
          ? 'max-batches'
          : 'deadline',
    batches,
    memory: memorySnapshot(),
    progress: await progress(supabase)
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
