// Copies MediaPipe's WASM runtime out of node_modules so the app serves it itself
// (no CDN needed, works offline after the first load). Only the two files the app can load
// are copied: the SIMD build and the no-SIMD fallback. The "module" build is unused.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const from = 'node_modules/@mediapipe/tasks-vision/wasm';
const to = 'public/mediapipe-wasm';
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const f of readdirSync(from)) {
  if (!f.includes('_module_')) cpSync(`${from}/${f}`, `${to}/${f}`);
}
