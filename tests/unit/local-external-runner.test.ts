import { describe, expect, it } from 'vitest';
import {
  captureProviderCircuitCooldowns,
  expireProviderCircuits,
  memorySnapshot,
  parseRunnerOptions,
  shouldApplyRollupBackpressure,
  shouldRecycleForMemory
} from '../../scripts/drain-external-metadata-local.js';
import type { ExternalMusicProviderCircuit } from '../../supabase/functions/_shared/external-music-worker.js';

describe('local external enrichment runner options', () => {
  it('defaults to a twelve-hour, globally paced, maximum-size drain', () => {
    expect(parseRunnerOptions([])).toEqual({
      durationHours: 12,
      batchSize: 20,
      leaseSeconds: 600,
      requestIntervalMs: 1_100,
      idleSeconds: 15,
      maxRollupBacklog: 500,
      maxRssMb: 512,
      memorySampleSeconds: 60,
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
      '--max-rollup-backlog=750',
      '--max-rss-mb=640',
      '--memory-sample-seconds=30'
    ])).toEqual({
      durationHours: 0.25,
      batchSize: 7,
      leaseSeconds: 180,
      requestIntervalMs: 1_500,
      idleSeconds: 3,
      maxRollupBacklog: 750,
      maxRssMb: 640,
      memorySampleSeconds: 30,
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

  it('reports process memory in MiB and recycles at the RSS ceiling', () => {
    const snapshot = memorySnapshot({
      rss: 512 * 1024 * 1024,
      heapTotal: 128 * 1024 * 1024,
      heapUsed: 96 * 1024 * 1024,
      external: 8 * 1024 * 1024,
      arrayBuffers: 4 * 1024 * 1024
    });

    expect(snapshot).toEqual({
      rssMb: 512,
      heapUsedMb: 96,
      heapTotalMb: 128,
      externalMb: 8,
      arrayBuffersMb: 4
    });
    expect(shouldRecycleForMemory({ ...snapshot, rssMb: 511.9 }, 512)).toBe(false);
    expect(shouldRecycleForMemory(snapshot, 512)).toBe(true);
  });

  it('carries a provider circuit across batches until its cooldown expires', () => {
    const circuit: ExternalMusicProviderCircuit = {
      musicbrainz: { terminal: false, retryAfterSeconds: 300, message: 'service unavailable' },
      lastfm: null
    };
    const expiresAt = { musicbrainz: null, lastfm: null };

    expect(captureProviderCircuitCooldowns(circuit, expiresAt, 1_000)).toEqual([
      {
        provider: 'musicbrainz',
        retryAfterSeconds: 300,
        retryAt: 301_000,
        message: 'service unavailable'
      }
    ]);
    expect(expireProviderCircuits(circuit, expiresAt, 300_999)).toEqual([]);
    expect(circuit.musicbrainz).not.toBeNull();
    expect(expireProviderCircuits(circuit, expiresAt, 301_000)).toEqual(['musicbrainz']);
    expect(circuit.musicbrainz).toBeNull();
    expect(expiresAt.musicbrainz).toBeNull();
  });
});
