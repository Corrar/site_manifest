import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  envDir: '..',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
});
