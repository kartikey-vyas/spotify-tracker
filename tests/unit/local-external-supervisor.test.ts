import { describe, expect, it } from 'vitest';
import {
  parseSupervisorOptions,
  workerNodeArguments
} from '../../scripts/supervise-external-metadata-local.js';

describe('local external enrichment supervisor', () => {
  it('defaults to bounded workers with memory controls and persistent logs', () => {
    expect(parseSupervisorOptions([])).toEqual({
      durationHours: 12,
      recycleAfterBatches: 25,
      recycleAfterMinutes: 30,
      maxRssMb: 512,
      memorySampleSeconds: 60,
      restartDelaySeconds: 5,
      workerGraceSeconds: 300,
      logDirectory: 'analysis/logs',
      providerStateFile: 'analysis/logs/external-provider-cooldowns.json',
      batchSize: 20,
      leaseSeconds: 600,
      requestIntervalMs: 1_100,
      idleSeconds: 15,
      maxRollupBacklog: 500
    });
  });

  it('starts workers with a smaller V8 heap and bounded lifetime', () => {
    const options = parseSupervisorOptions([]);
    expect(workerNodeArguments(options, 0.5, '/repo/scripts/worker.ts')).toEqual([
      '--max-old-space-size=384',
      '--import',
      'tsx',
      '/repo/scripts/worker.ts',
      '--duration-hours=0.5',
      '--max-batches=25',
      '--batch-size=20',
      '--lease-seconds=600',
      '--request-interval-ms=1100',
      '--idle-seconds=15',
      '--max-rollup-backlog=500',
      '--max-rss-mb=512',
      '--memory-sample-seconds=60',
      '--provider-state-file=analysis/logs/external-provider-cooldowns.json'
    ]);
  });

  it('rejects unsafe request pacing and unknown arguments', () => {
    expect(() => parseSupervisorOptions(['--request-interval-ms=999'])).toThrow(
      '--request-interval-ms must be between 1000 and 60000'
    );
    expect(() => parseSupervisorOptions(['--forever=true'])).toThrow(
      'Unknown argument: --forever=true'
    );
  });
});
