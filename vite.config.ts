import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the production build can be served from any sub-path
  // (or straight off the filesystem via `vite preview`).
  base: './',
  // pdf.js ships an ESM worker; pre-bundling it confuses the worker handshake.
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
  },
  server: {
    port: 5173,
  },
});