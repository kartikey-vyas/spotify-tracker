import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { memorySnapshot } from './drain-external-metadata-local.js';

const DEFAULT_DURATION_HOURS = 12;
const DEFAULT_RECYCLE_AFTER_BATCHES = 25;
const DEFAULT_RECYCLE_AFTER_MINUTES = 30;
const DEFAULT_MAX_RSS_MB = 512;
const DEFAULT_MEMORY_SAMPLE_SECONDS = 60;
const DEFAULT_RESTART_DELAY_SECONDS = 5;
const DEFAULT_WORKER_GRACE_SECONDS = 300;
const DEFAULT_LOG_DIRECTORY = 'analysis/logs';

export type SupervisorOptions = {
  durationHours: number;
  recycleAfterBatches: number;
  recycleAfterMinutes: number;
  maxRssMb: number;
  memorySampleSeconds: number;
  restartDelaySeconds: number;
  workerGraceSeconds: number;
  logDirectory: string;
  batchSize: number;
  leaseSeconds: number;
  requestIntervalMs: number;
  idleSeconds: number;
  maxRollupBacklog: number;
};

type WorkerResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  runtimeSeconds: number;
  error: string | null;
};

function numericFlag(argv: string[], name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
}

function stringFlag(argv: string[], name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const value = argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (value === undefined) return fallback;
  if (value.trim() === '') throw new Error(`--${name} cannot be empty`);
  return value;
}

function boundedNumber(value: number | undefined, fallback: number, minimum: number, maximum: number, name: string) {
  const resolved = value ?? fallback;
  if (resolved < minimum || resolved > maximum) {
    throw new Error(`--${name} must be between ${minimum} and ${maximum}`);
  }
  return resolved;
}

export function parseSupervisorOptions(argv: string[]): SupervisorOptions {
  const supported = [
    'duration-hours',
    'recycle-after-batches',
    'recycle-after-minutes',
    'max-rss-mb',
    'memory-sample-seconds',
    'restart-delay-seconds',
    'worker-grace-seconds',
    'log-directory',
    'batch-size',
    'lease-seconds',
    'request-interval-ms',
    'idle-seconds',
    'max-rollup-backlog'
  ];
  const unknown = argv.filter((value) => !supported.some((name) => value.startsWith(`--${name}=`)));
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);

  return {
    durationHours: boundedNumber(
      numericFlag(argv, 'duration-hours'),
      DEFAULT_DURATION_HOURS,
      1 / 60,
      168,
      'duration-hours'
    ),
    recycleAfterBatches: Math.trunc(boundedNumber(
      numericFlag(argv, 'recycle-after-batches'),
      DEFAULT_RECYCLE_AFTER_BATCHES,
      1,
      1_000,
      'recycle-after-batches'
    )),
    recycleAfterMinutes: Math.trunc(boundedNumber(
      numericFlag(argv, 'recycle-after-minutes'),
      DEFAULT_RECYCLE_AFTER_MINUTES,
      1,
      1_440,
      'recycle-after-minutes'
    )),
    maxRssMb: Math.trunc(boundedNumber(
      numericFlag(argv, 'max-rss-mb'),
      DEFAULT_MAX_RSS_MB,
      128,
      16_384,
      'max-rss-mb'
    )),
    memorySampleSeconds: Math.trunc(boundedNumber(
      numericFlag(argv, 'memory-sample-seconds'),
      DEFAULT_MEMORY_SAMPLE_SECONDS,
      10,
      3_600,
      'memory-sample-seconds'
    )),
    restartDelaySeconds: Math.trunc(boundedNumber(
      numericFlag(argv, 'restart-delay-seconds'),
      DEFAULT_RESTART_DELAY_SECONDS,
      1,
      300,
      'restart-delay-seconds'
    )),
    workerGraceSeconds: Math.trunc(boundedNumber(
      numericFlag(argv, 'worker-grace-seconds'),
      DEFAULT_WORKER_GRACE_SECONDS,
      30,
      1_800,
      'worker-grace-seconds'
    )),
    logDirectory: stringFlag(argv, 'log-directory', DEFAULT_LOG_DIRECTORY),
    batchSize: Math.trunc(boundedNumber(numericFlag(argv, 'batch-size'), 20, 1, 20, 'batch-size')),
    leaseSeconds: Math.trunc(boundedNumber(
      numericFlag(argv, 'lease-seconds'),
      600,
      60,
      600,
      'lease-seconds'
    )),
    requestIntervalMs: Math.trunc(boundedNumber(
      numericFlag(argv, 'request-interval-ms'),
      1_100,
      1_000,
      60_000,
      'request-interval-ms'
    )),
    idleSeconds: Math.trunc(boundedNumber(numericFlag(argv, 'idle-seconds'), 15, 1, 300, 'idle-seconds')),
    maxRollupBacklog: Math.trunc(boundedNumber(
      numericFlag(argv, 'max-rollup-backlog'),
      500,
      1,
      100_000,
      'max-rollup-backlog'
    ))
  };
}

export function workerNodeArguments(
  options: SupervisorOptions,
  workerDurationHours: number,
  workerPath: string
): string[] {
  const oldSpaceMb = Math.max(64, options.maxRssMb - 128);
  return [
    `--max-old-space-size=${oldSpaceMb}`,
    '--import',
    'tsx',
    workerPath,
    `--duration-hours=${workerDurationHours}`,
    `--max-batches=${options.recycleAfterBatches}`,
    `--batch-size=${options.batchSize}`,
    `--lease-seconds=${options.leaseSeconds}`,
    `--request-interval-ms=${options.requestIntervalMs}`,
    `--idle-seconds=${options.idleSeconds}`,
    `--max-rollup-backlog=${options.maxRollupBacklog}`,
    `--max-rss-mb=${options.maxRssMb}`,
    `--memory-sample-seconds=${options.memorySampleSeconds}`
  ];
}

function logFileName(now = new Date()): string {
  return `external-enrichment-${now.toISOString().replaceAll(':', '').replaceAll('.', '-')}.jsonl`;
}

function createLogger(logStream: WriteStream) {
  return (event: string, details: Record<string, unknown> = {}) => {
    const line = `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`;
    process.stdout.write(line);
    logStream.write(line);
  };
}

function waitForWorker(child: ChildProcess, startedAt: number): Promise<WorkerResult> {
  return new Promise((resolveWorker) => {
    let settled = false;
    const resolveOnce = (result: WorkerResult) => {
      if (settled) return;
      settled = true;
      resolveWorker(result);
    };
    child.once('error', (error) => {
      resolveOnce({
        code: null,
        signal: null,
        runtimeSeconds: Math.round((Date.now() - startedAt) / 1_000),
        error: error.message
      });
    });
    child.once('close', (code, signal) => {
      resolveOnce({
        code,
        signal,
        runtimeSeconds: Math.round((Date.now() - startedAt) / 1_000),
        error: null
      });
    });
  });
}

async function interruptibleSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  try {
    await sleep(milliseconds, undefined, { signal });
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseSupervisorOptions(argv);
  const deadline = Date.now() + options.durationHours * 60 * 60 * 1_000;
  const logPath = resolve(options.logDirectory, logFileName());
  mkdirSync(dirname(logPath), { recursive: true });
  const logStream = createWriteStream(logPath, { flags: 'a' });
  logStream.on('error', (error) => {
    process.stderr.write(`Local enrichment log failed: ${error.message}\n`);
  });
  const log = createLogger(logStream);
  const shutdown = new AbortController();
  const workerPath = fileURLToPath(new URL('./drain-external-metadata-local.ts', import.meta.url));
  let activeChild: ChildProcess | null = null;
  let stopping = false;
  let workersStarted = 0;
  let consecutiveFailures = 0;

  const requestStop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    shutdown.abort();
    log('supervisor-stop-requested', {
      signal,
      childPid: activeChild?.pid ?? null,
      message: 'Waiting for the active worker to finish its claimed batch'
    });
    activeChild?.kill(signal);
  };
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);

  log('supervisor-started', {
    pid: process.pid,
    deadline: new Date(deadline).toISOString(),
    logPath,
    recycleAfterBatches: options.recycleAfterBatches,
    recycleAfterMinutes: options.recycleAfterMinutes,
    maxRssMb: options.maxRssMb,
    workerOldSpaceMb: Math.max(64, options.maxRssMb - 128),
    memorySampleSeconds: options.memorySampleSeconds,
    batchSize: options.batchSize,
    requestIntervalMs: options.requestIntervalMs,
    maxRollupBacklog: options.maxRollupBacklog
  });

  const supervisorMemoryTimer = setInterval(() => {
    log('supervisor-memory-snapshot', {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      ...memorySnapshot()
    });
  }, options.memorySampleSeconds * 1_000);
  supervisorMemoryTimer.unref();

  try {
    while (!stopping && Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      const workerDurationMs = Math.min(remainingMs, options.recycleAfterMinutes * 60 * 1_000);
      const workerDurationHours = workerDurationMs / 60 / 60 / 1_000;
      const workerArgs = workerNodeArguments(options, workerDurationHours, workerPath);
      const startedAt = Date.now();
      workersStarted += 1;
      activeChild = spawn(process.execPath, workerArgs, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      activeChild.stdout?.pipe(process.stdout, { end: false });
      activeChild.stdout?.pipe(logStream, { end: false });
      activeChild.stderr?.pipe(process.stderr, { end: false });
      activeChild.stderr?.pipe(logStream, { end: false });
      log('worker-started', {
        worker: workersStarted,
        childPid: activeChild.pid ?? null,
        workerDurationMinutes: Math.round(workerDurationMs / 60_000 * 10) / 10
      });

      let forceKillTimer: NodeJS.Timeout | null = null;
      const graceTimer = setTimeout(() => {
        if (!activeChild || activeChild.exitCode !== null || activeChild.signalCode !== null) return;
        log('worker-grace-exceeded', {
          worker: workersStarted,
          childPid: activeChild.pid ?? null,
          workerGraceSeconds: options.workerGraceSeconds
        });
        activeChild.kill('SIGTERM');
        forceKillTimer = setTimeout(() => {
          if (!activeChild || activeChild.exitCode !== null || activeChild.signalCode !== null) return;
          log('worker-force-kill', { worker: workersStarted, childPid: activeChild.pid ?? null });
          activeChild.kill('SIGKILL');
        }, 60_000);
        forceKillTimer.unref();
      }, workerDurationMs + options.workerGraceSeconds * 1_000);
      graceTimer.unref();

      let result: WorkerResult;
      try {
        result = await waitForWorker(activeChild, startedAt);
      } finally {
        clearTimeout(graceTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
      }
      activeChild = null;
      log('worker-exited', { worker: workersStarted, ...result });

      if (stopping || Date.now() >= deadline) break;
      if (result.code === 0) {
        consecutiveFailures = 0;
        log('worker-recycle-pause', {
          worker: workersStarted,
          pauseMilliseconds: options.requestIntervalMs,
          reason: 'Preserve global provider pacing across worker boundaries'
        });
        await interruptibleSleep(options.requestIntervalMs, shutdown.signal);
        continue;
      }

      consecutiveFailures += 1;
      const backoffSeconds = Math.min(
        300,
        options.restartDelaySeconds * 2 ** Math.min(consecutiveFailures - 1, 6)
      );
      log('worker-restart-backoff', {
        worker: workersStarted,
        consecutiveFailures,
        backoffSeconds,
        code: result.code,
        signal: result.signal
      });
      await interruptibleSleep(backoffSeconds * 1_000, shutdown.signal);
    }
  } finally {
    clearInterval(supervisorMemoryTimer);
    log('supervisor-finished', {
      reason: stopping ? 'signal' : 'deadline',
      workersStarted,
      memory: memorySnapshot(),
      logPath
    });
    await new Promise<void>((resolveLog) => logStream.end(resolveLog));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
