import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {'@': fileURLToPath(new URL('./src', import.meta.url))},
  },
  // Pre-bundling breaks anitomy-ng's WebAssembly import in dev.
  optimizeDeps: {exclude: ['anitomy-ng']},
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? {protocol: 'ws', host, port: 1421} : undefined,
    watch: {ignored: ['**/src-tauri/**']},
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
