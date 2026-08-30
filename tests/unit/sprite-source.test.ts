import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { characterRegistry, promenadePerson } from '../../src/lib/pixel-person/characters';
import { artistRegistry } from '../../src/lib/pixel-person/artists';
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
  return `const before = 1;\n\nconst ${name} = frameOfSize(${FRAME_WIDTH}, ${FRAME_HEIGHT}, [\n${rows
    .map((r) => `  '${r}'`)
    .join(',\n')}\n]);\n\nconst after = 2;\n`;
}

describe('frame constants', () => {
  it('matches the high-density authored frame size', () => {
    expect(FRAME_WIDTH).toBe(48);
    expect(FRAME_HEIGHT).toBe(64);
  });

  it('covers every key used by the high-density palettes', () => {
    expect(PALETTE_KEYS).toBe('oghfstpbna');
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
    expect(validateFrameRows(validRows.slice(0, 10))).toMatch(/expected 64 rows/);
  });

  it('rejects a row of the wrong width', () => {
    const rows = [...validRows];
    rows[3] = '.'.repeat(FRAME_WIDTH - 1);
    expect(validateFrameRows(rows)).toMatch(/row 3 is 47 characters/);
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
  it('turns a generated frame into a literal override', () => {
    const source =
      'const before = 1;\n' +
      'const idleA = makePilotStandingFrame({ bob: 1, leftHand: [9, 43] });\n' +
      'const after = 2;\n';
    const rows = [...validRows];
    rows[4] = 'a'.repeat(FRAME_WIDTH);

    const out = spliceFrame(source, 'idleA', rows);

    expect(out).toContain(`const idleA = frameOfSize(48, 64, [`);
    expect(out).toContain(`  '${'a'.repeat(FRAME_WIDTH)}'`);
    expect(out).not.toContain('makePilotStandingFrame');
    expect(out).toContain('const before = 1;');
    expect(out).toContain('const after = 2;');
  });

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
    expect(out.split('= frameOfSize(').length - 1).toBe(2);
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
    const truncated = 'const idleA = frameOfSize(48, 64, [\n  \'....\'';
    expect(() => spliceFrame(truncated, 'idleA', validRows)).toThrow(/unterminated/);
  });

  it('throws on an unbalanced initializer rather than swallowing following code', () => {
    const malformed = 'const idleA = makePilotStandingFrame({}));\nconst after = 2;\n';
    expect(() => spliceFrame(malformed, 'idleA', validRows)).toThrow(/malformed/);
  });

  it('rejects an invalid grid before touching the source', () => {
    expect(() => spliceFrame(sourceWith('idleA', validRows), 'idleA', ['too short'])).toThrow(
      /expected 64 rows/
    );
  });
});

describe('frameSource maps', () => {
  const everyCharacter = [
    ...Object.values(characterRegistry),
    ...artistRegistry.map((entry) => entry.character)
  ];

  it('covers every frame of every animation, for every character', () => {
    // The editor resolves a frame to its source identifier through this map; a
    // missing entry means that frame silently cannot be saved.
    for (const character of everyCharacter) {
      const expected = new Set<string>();
      for (const [name, animation] of Object.entries(character.animations)) {
        animation.frames.forEach((_frame, index) => expected.add(`${name}:${index}`));
      }
      expect(new Set(Object.keys(character.frameSource.names))).toEqual(expected);
    }
  });

  it('names frames that actually exist in the file it points at', async () => {
    for (const character of everyCharacter) {
      const source = await readFile(character.frameSource.file, 'utf8');
      for (const identifier of Object.values(character.frameSource.names)) {
        expect(source).toContain(`const ${identifier} =`);
      }
    }
  });

  it('keeps every shipped high-density character paint-editable', () => {
    for (const character of everyCharacter) {
      expect(character.frameSource.editable).not.toBe(false);
      expect(character.pixelWidth).toBe(FRAME_WIDTH);
      expect(character.pixelHeight).toBe(FRAME_HEIGHT);
    }
  });

  it('points shared frames at the same identifier', () => {
    // hide reuses the idle B-frame in every character; the map must say so, or
    // editing hide:1 would write to a literal that does not back it.
    for (const character of everyCharacter) {
      expect(character.frameSource.names['hide:1']).toBe(character.frameSource.names['idle:1']);
      expect(character.animations.hide.frames[1]).toBe(character.animations.idle.frames[1]);
    }
  });

  it('gives forked characters their own literals, in their own file', () => {
    const frank = artistRegistry[0].character;
    expect(frank.frameSource.file).not.toBe(promenadePerson.frameSource.file);
    // No identifier may be shared across the two, or an edit to one would
    // silently reach the other.
    const generic = new Set(Object.values(promenadePerson.frameSource.names));
    for (const name of Object.values(frank.frameSource.names)) {
      expect(generic.has(name)).toBe(false);
    }
    expect(frank.animations.idle.frames[0]).not.toBe(promenadePerson.animations.idle.frames[0]);
  });
});
