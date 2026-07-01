import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('/explore source', () => {
  it('does not render the old ASCII distribution chart', () => {
    const source = readFileSync(resolve('src/routes/explore/+page.svelte'), 'utf8');

    expect(source).not.toContain('Distribution');
    expect(source).not.toContain('asciiBarRows');
    expect(source).not.toContain('glyphTimeline');
  });
});
