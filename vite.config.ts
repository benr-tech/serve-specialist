import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Dev-only: lets the browser save a decoded pose track to samples/tracks/<name>.json so the
 * analysis can be re-run offline (devtools/), and contact sheets to samples/sheets/. Never part
 * of the production build.
 */
function saveTracks(): Plugin {
  return {
    name: 'dev-save-tracks',
    apply: 'serve',
    configureServer(server) {
      const save = (route: string, dir: string, ext: string) =>
        server.middlewares.use(route, (req, res) => {
          const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
          if (req.method !== 'POST' || !/^[\w.-]+$/.test(name)) {
            res.statusCode = 400;
            res.end('bad request');
            return;
          }
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            mkdirSync(dir, { recursive: true });
            writeFileSync(`${dir}/${name}${ext}`, Buffer.concat(chunks));
            res.end('ok');
          });
        });
      save('/__dev/save-track', 'samples/tracks', '.json');
      // Contact sheets from devtools/sheet.ts.
      save('/__dev/save-sheet', 'samples/sheets', '.png');
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the same build works at a site root (Netlify) or a sub-path (GitHub Pages).
  base: './',
  plugins: [react(), tailwindcss(), saveTracks()],
  build: {
    rollupOptions: {
      input: { main: 'index.html', bench: 'bench.html' },
    },
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
