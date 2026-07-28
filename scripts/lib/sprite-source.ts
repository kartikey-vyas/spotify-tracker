/**
 * Rewrites a single pixel-art frame literal inside a source file.
 *
 * Backs the dev-only sprite editor: the browser posts a 24x32 grid, this
 * splices it into `const <name> = frame([ ... ]);` and Vite's HMR picks the
 * change up. Kept free of any Vite or DOM types so it is unit-testable in the
 * node environment, like `dev-routes.ts`.
 *
 * Everything here is defensive on purpose — it writes to source files on
 * request from a browser, so a malformed grid must be rejected before it can
 * corrupt a file rather than after.
 */

export const FRAME_WIDTH = 24;
export const FRAME_HEIGHT = 32;

/**
 * Palette keys a frame row may use, plus `.` for transparent. Kept in step with
 * the rig's real palette by a unit test rather than by hope.
 */
export const PALETTE_KEYS = 'oghfstpbn';

/** Only these files hold frame literals; anything else is rejected outright. */
export const EDITABLE_SOURCES: readonly string[] = [
  'src/lib/pixel-person/characters.ts',
  'src/lib/pixel-person/artists.ts'
];

/** Returns a human-readable reason the rows are unusable, or null if they're fine. */
export function validateFrameRows(rows: unknown): string | null {
  if (!Array.isArray(rows)) return 'rows must be an array';
  if (rows.length !== FRAME_HEIGHT) {
    return `expected ${FRAME_HEIGHT} rows, got ${rows.length}`;
  }
  const allowed = new Set([...PALETTE_KEYS, '.']);
  for (const [index, row] of rows.entries()) {
    if (typeof row !== 'string') return `row ${index} is not a string`;
    if (row.length !== FRAME_WIDTH) {
      return `row ${index} is ${row.length} characters, expected ${FRAME_WIDTH}`;
    }
    for (const character of row) {
      if (!allowed.has(character)) {
        return `row ${index} contains '${character}', which is not a palette key`;
      }
    }
  }
  return null;
}

/** A frame name must be a bare identifier — it is interpolated into a matcher. */
export function isFrameName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(name);
}

export function isEditableSource(file: unknown): file is string {
  return typeof file === 'string' && EDITABLE_SOURCES.includes(file);
}

/**
 * Replaces the row literals of `const <frameName> = frame([ ... ]);` in `source`.
 * Throws if the frame is absent or its literal is unterminated, so a bad splice
 * fails loudly instead of writing a mangled file.
 */
export function spliceFrame(source: string, frameName: string, rows: string[]): string {
  if (!isFrameName(frameName)) throw new Error(`invalid frame name: ${String(frameName)}`);
  const invalid = validateFrameRows(rows);
  if (invalid) throw new Error(invalid);

  const opener = `const ${frameName} = frame([`;
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`frame '${frameName}' not found`);

  const bodyStart = start + opener.length;
  const end = source.indexOf(']);', bodyStart);
  if (end === -1) throw new Error(`frame '${frameName}' literal is unterminated`);

  // Guard against swallowing a following frame if the literal were malformed:
  // no other frame opener may appear inside the span being replaced.
  if (source.slice(bodyStart, end).includes('= frame([')) {
    throw new Error(`frame '${frameName}' literal is malformed`);
  }

  const body = '\n' + rows.map((row) => `  '${row}'`).join(',\n') + '\n';
  return source.slice(0, bodyStart) + body + source.slice(end);
}
