// Builds only the audio lab page: npx vite build --config dev/vite.audio.config.mjs
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig({
  root,
  base: './',
  build: { outDir: process.env.OUT_DIR || '/tmp/hk-audio-build', emptyOutDir: true, target: 'es2022', rollupOptions: { input: root + 'dev/audio.html' } },
});
