import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import {
  isEditableSource,
  isFrameName,
  spliceFrame,
  validateFrameRows
} from './scripts/lib/sprite-source.js';

/**
 * Save endpoint for the dev-only sprite editor at /sprites/edit/.
 *
 * `apply: 'serve'` keeps it out of `vite build` entirely, so it has no
 * production surface — matching how the editor route itself is dev-gated and
 * stripped from the build output.
 *
 * It writes to source files on a request from a browser, so every input is
 * checked before anything is opened: the file must be one of two known paths,
 * the frame name a bare identifier, and the grid exactly 32x24 of palette keys.
 */
function spriteEditorApi(): Plugin {
  return {
    name: 'sprite-editor-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__sprite/save', (request, response, next) => {
        if (request.method !== 'POST') return next();

        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          const send = (status: number, body: Record<string, unknown>): void => {
            response.statusCode = status;
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify(body));
          };

          void (async () => {
            try {
              const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const { file, frame, rows } = payload ?? {};

              if (!isEditableSource(file)) {
                return send(400, { error: `not an editable source: ${String(file)}` });
              }
              if (!isFrameName(frame)) {
                return send(400, { error: `not a frame name: ${String(frame)}` });
              }
              const invalid = validateFrameRows(rows);
              if (invalid) return send(400, { error: invalid });

              const path = resolve(server.config.root, file);
              const source = await readFile(path, 'utf8');
              const updated = spliceFrame(source, frame, rows);
              const changed = updated !== source;
              if (changed) await writeFile(path, updated, 'utf8');
              send(200, { ok: true, changed });
            } catch (error) {
              send(400, { error: error instanceof Error ? error.message : String(error) });
            }
          })();
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [sveltekit(), spriteEditorApi()],
  test: {
    include: ['tests/**/*.test.ts']
  }
});
