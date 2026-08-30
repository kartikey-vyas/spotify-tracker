import { describe, expect, it } from 'vitest';
import {
  parseRunnerOptions,
  shouldApplyRollupBackpressure
} from '../../scripts/drain-external-metadata-local.js';

describe('local external enrichment runner options', () => {
  it('defaults to a twelve-hour, globally paced, maximum-size drain', () => {
    expect(parseRunnerOptions([])).toEqual({
      durationHours: 12,
      batchSize: 20,
      leaseSeconds: 600,
      requestIntervalMs: 1_100,
      idleSeconds: 15,
      maxRollupBacklog: 500,
      maxBatches: Number.POSITIVE_INFINITY
    });
  });

  it('supports a bounded one-batch smoke test', () => {
    expect(parseRunnerOptions([
      '--once',
      '--duration-hours=0.25',
      '--batch-size=7',
      '--lease-seconds=180',
      '--request-interval-ms=1500',
      '--idle-seconds=3',
      '--max-rollup-backlog=750'
    ])).toEqual({
      durationHours: 0.25,
      batchSize: 7,
      leaseSeconds: 180,
      requestIntervalMs: 1_500,
      idleSeconds: 3,
      maxRollupBacklog: 750,
      maxBatches: 1
    });
  });

  it('rejects settings that could exceed one provider request per second', () => {
    expect(() => parseRunnerOptions(['--request-interval-ms=999'])).toThrow(
      '--request-interval-ms must be between 1000 and 60000'
    );
  });

  it('rejects unsupported arguments instead of silently ignoring them', () => {
    expect(() => parseRunnerOptions(['--forever'])).toThrow('Unknown argument: --forever');
  });

  it('stops claiming at the configured rollup backlog threshold', () => {
    expect(shouldApplyRollupBackpressure(499, 500)).toBe(false);
    expect(shouldApplyRollupBackpressure(500, 500)).toBe(true);
  });
});
