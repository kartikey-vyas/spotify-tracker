import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { FRAME_SOURCE_NAMES, tinyPerson } from '../../src/lib/pixel-person/characters';
import {
  EDITABLE_SOURCES,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  isEditableSource,
  isFrameName,
  PALETTE_KEYS,
  spliceFrame,
  validateFrameRows
} from '../../scripts/lib/sprite-source';

const validRows = Array.from({ length: FRAME_HEIGHT }, () => '.'.repeat(FRAME_WIDTH));

function sourceWith(name: string, rows: string[]): string {
  return `const before = 1;\n\nconst ${name} = frame([\n${rows
    .map((r) => `  '${r}'`)
    .join(',\n')}\n]);\n\nconst after = 2;\n`;
}

describe('frame constants', () => {
  it('matches the rig the editor is editing', () => {
    // If the grid is resized again, this fails rather than letting the editor
    // silently write frames of the wrong shape.
    expect(FRAME_WIDTH).toBe(tinyPerson.pixelWidth);
    expect(FRAME_HEIGHT).toBe(tinyPerson.pixelHeight);
  });

  it('covers every palette key the rig actually uses', () => {
    for (const key of Object.keys(tinyPerson.palette)) {
      expect(PALETTE_KEYS).toContain(key);
    }
  });
});

describe('validateFrameRows', () => {
  it('accepts a well-formed grid', () => {
    expect(validateFrameRows(validRows)).toBeNull();
  });

  it('rejects a non-array', () => {
    expect(validateFrameRows('nope')).toMatch(/array/);
  });

  it('rejects the wrong row count', () => {
    expect(validateFrameRows(validRows.slice(0, 10))).toMatch(/expected 32 rows/);
  });

  it('rejects a row of the wrong width', () => {
    const rows = [...validRows];
    rows[3] = '.'.repeat(FRAME_WIDTH - 1);
    expect(validateFrameRows(rows)).toMatch(/row 3 is 23 characters/);
  });

  it('rejects a character outside the palette', () => {
    const rows = [...validRows];
    rows[5] = 'z' + '.'.repeat(FRAME_WIDTH - 1);
    expect(validateFrameRows(rows)).toMatch(/'z'/);
  });

  it('rejects a non-string row', () => {
    const rows: unknown[] = [...validRows];
    rows[0] = 42;
    expect(validateFrameRows(rows)).toMatch(/not a string/);
  });
});

describe('isFrameName', () => {
  it('accepts bare identifiers', () => {
    expect(isFrameName('idleA')).toBe(true);
    expect(isFrameName('frankSignature')).toBe(true);
  });

  it('rejects anything that could break out of the matcher', () => {
    for (const bad of ['', 'idle A', 'idle-A', "idle');rm -rf /", '../x', 1, null]) {
      expect(isFrameName(bad)).toBe(false);
    }
  });
});

describe('isEditableSource', () => {
  it('accepts only the two files holding frame literals', () => {
    for (const file of EDITABLE_SOURCES) expect(isEditableSource(file)).toBe(true);
  });

  it('rejects traversal and unrelated files', () => {
    for (const bad of [
      '../../../etc/passwd',
      'src/lib/pixel-person/render.ts',
      'package.json',
      '',
      null
    ]) {
      expect(isEditableSource(bad)).toBe(false);
    }
  });
});

describe('spliceFrame', () => {
  it('replaces only the target frame body', () => {
    const rows = [...validRows];
    rows[0] = 'o'.repeat(FRAME_WIDTH);
    const out = spliceFrame(sourceWith('idleA', validRows), 'idleA', rows);
    expect(out).toContain(`  '${'o'.repeat(FRAME_WIDTH)}'`);
    expect(out).toContain('const before = 1;');
    expect(out).toContain('const after = 2;');
  });

  it('leaves neighbouring frames untouched', () => {
    const source =
      sourceWith('idleA', validRows) + '\n' + sourceWith('idleB', validRows);
    const rows = [...validRows];
    rows[1] = 'h'.repeat(FRAME_WIDTH);
    const out = spliceFrame(source, 'idleB', rows);
    // Exactly one frame gained the new row.
    expect(out.split(`  '${'h'.repeat(FRAME_WIDTH)}'`).length - 1).toBe(1);
    // And both literals still parse as separate frames.
    expect(out.split('= frame([').length - 1).toBe(2);
  });

  it('round-trips: splicing a frame with its own rows is a no-op', () => {
    const source = sourceWith('idleA', validRows);
    expect(spliceFrame(source, 'idleA', validRows)).toBe(source);
  });

  it('throws when the frame does not exist', () => {
    expect(() => spliceFrame(sourceWith('idleA', validRows), 'nope', validRows)).toThrow(
      /not found/
    );
  });

  it('throws on an unterminated literal rather than writing anything', () => {
    const truncated = 'const idleA = frame([\n  \'....\'';
    expect(() => spliceFrame(truncated, 'idleA', validRows)).toThrow(/unterminated/);
  });

  it('throws rather than swallowing a following frame', () => {
    const malformed = "const idleA = frame([\n  '..'\nconst idleB = frame([\n]);\n";
    expect(() => spliceFrame(malformed, 'idleA', validRows)).toThrow(/malformed/);
  });

  it('rejects an invalid grid before touching the source', () => {
    expect(() => spliceFrame(sourceWith('idleA', validRows), 'idleA', ['too short'])).toThrow(
      /expected 32 rows/
    );
  });
});

describe('FRAME_SOURCE_NAMES', () => {
  it('covers every frame of every animation, and nothing more', () => {
    // The editor resolves a frame to its source identifier through this map; a
    // missing entry means that frame silently cannot be saved.
    const expected = new Set<string>();
    for (const [name, animation] of Object.entries(tinyPerson.animations)) {
      animation.frames.forEach((_frame, index) => expected.add(`${name}:${index}`));
    }
    expect(new Set(Object.keys(FRAME_SOURCE_NAMES))).toEqual(expected);
  });

  it('names a frame that actually exists in the source file', async () => {
    const source = await readFile('src/lib/pixel-person/characters.ts', 'utf8');
    for (const identifier of Object.values(FRAME_SOURCE_NAMES)) {
      expect(source).toContain(`const ${identifier} = frame([`);
    }
  });

  it('points shared frames at the same identifier', () => {
    // hide reuses idleB; the map must say so or editing hide:1 would write to a
    // frame literal that does not back it.
    expect(FRAME_SOURCE_NAMES['hide:1']).toBe(FRAME_SOURCE_NAMES['idle:1']);
    expect(tinyPerson.animations.hide.frames[1]).toBe(tinyPerson.animations.idle.frames[1]);
  });
});
