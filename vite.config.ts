import { defineConfig } from 'vite';

// Relative base so the static build works from any path (GitHub Pages, itch.io, a subfolder).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
