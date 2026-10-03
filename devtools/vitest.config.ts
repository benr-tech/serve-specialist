// Runs the offline analysis harness: npx vitest run --config devtools/vitest.config.ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: path.resolve(import.meta.dirname, '..'),
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '../src') } },
  test: { include: ['devtools/**/*.dev.ts'], testTimeout: 120_000 },
});
