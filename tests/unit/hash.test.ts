import { describe, expect, it } from 'vitest';
import { sha256 } from '../../scripts/lib/hash.js';

describe('hash helper', () => {
  it('is deterministic', () => {
    expect(sha256(['export', '2026-06-19', 'spotify:track:abc'])).toBe(
      sha256(['export', '2026-06-19', 'spotify:track:abc'])
    );
  });

  it('separates empty values without collisions from concatenation', () => {
    expect(sha256(['a', 'bc'])).not.toBe(sha256(['ab', 'c']));
  });
});
