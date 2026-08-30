/**
 * Rewrites a single pixel-art frame declaration inside a source file.
 *
 * Backs the dev-only sprite editor: the browser posts a 48x64 grid and this
 * replaces the selected frame declaration with a literal `frameOfSize(...)`
 * override. That works whether the frame was still generated from drawing
 * primitives or had already been hand-edited; Vite's HMR picks the change up.
 * Kept free of any Vite or DOM types so it is unit-testable in the node
 * environment, like `dev-routes.ts`.
 *
 * Everything here is defensive on purpose — it writes to source files on
 * request from a browser, so a malformed grid must be rejected before it can
 * corrupt a file rather than after.
 */

export const FRAME_WIDTH = 48;
export const FRAME_HEIGHT = 64;

/**
 * Palette keys a frame row may use, plus `.` for transparent. Kept in step with
 * the rig's real palette by a unit test rather than by hope.
 */
export const PALETTE_KEYS = 'oghfstpbna';

/** Only these files own editable frame declarations; anything else is rejected outright. */
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

/** Finds the semicolon ending a frame initializer without being fooled by nested calls. */
function declarationEnd(source: string, expressionStart: number, frameName: string): number {
  let round = 0;
  let square = 0;
  let curly = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = expressionStart; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === '(') round += 1;
    else if (character === ')') round -= 1;
    else if (character === '[') square += 1;
    else if (character === ']') square -= 1;
    else if (character === '{') curly += 1;
    else if (character === '}') curly -= 1;
    else if (character === ';' && round === 0 && square === 0 && curly === 0) return index + 1;

    // A missing semicolon must not make the splice consume the declaration
    // after the frame. The authored sources use semicolons, so reaching a new
    // top-level declaration first is always an error rather than ASI we should
    // try to preserve.
    if (
      (character === '\n' || character === '\r') &&
      round === 0 &&
      square === 0 &&
      curly === 0 &&
      /^\s*(?:export\s+)?(?:const|let|var|function|class|interface|type|enum)\b/.test(
        source.slice(index + 1)
      )
    ) {
      throw new Error(`frame '${frameName}' initializer is malformed`);
    }

    if (round < 0 || square < 0 || curly < 0) {
      throw new Error(`frame '${frameName}' initializer is malformed`);
    }
  }

  throw new Error(`frame '${frameName}' initializer is unterminated`);
}

/**
 * Replaces an entire frame initializer with an editable high-density literal.
 * Throws if the declaration is missing, duplicated or malformed so a bad save
 * fails loudly instead of writing a mangled source file.
 */
export function spliceFrame(source: string, frameName: string, rows: string[]): string {
  if (!isFrameName(frameName)) throw new Error(`invalid frame name: ${String(frameName)}`);
  const invalid = validateFrameRows(rows);
  if (invalid) throw new Error(invalid);

  const opener = `const ${frameName} =`;
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`frame '${frameName}' not found`);
  if (source.indexOf(opener, start + opener.length) !== -1) {
    throw new Error(`frame '${frameName}' declaration is ambiguous`);
  }

  const end = declarationEnd(source, start + opener.length, frameName);
  const initializer = source.slice(start + opener.length, end - 1).trim();
  if (!/^(?:frameOfSize|make[A-Za-z][A-Za-z0-9_]*Frame)\s*\(/.test(initializer)) {
    throw new Error(`'${frameName}' is not an editable frame declaration`);
  }
  const literal =
    `const ${frameName} = frameOfSize(${FRAME_WIDTH}, ${FRAME_HEIGHT}, [\n` +
    rows.map((row) => `  '${row}'`).join(',\n') +
    '\n]);';
  return source.slice(0, start) + literal + source.slice(end);
}
