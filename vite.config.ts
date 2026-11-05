/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const host = process.env.TAURI_DEV_HOST;
const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || '127.0.0.1',
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    // .cache holds downloaded sources and render output; tools/ are offline build scripts.
    watch: { ignored: ['**/src-tauri/**', '**/.cache/**', '**/tools/**'] },
  },
  // Scan only the app pages: by default Vite also scans .cache/ (cloned asset repos), pushing the dev server to ~4 GB of memory.
  optimizeDeps: { entries: ['index.html', 'pet.html'] },
  build: {
    // WebView2 on Windows is evergreen Chromium; WKWebView/WebKitGTK need a Safari-level target.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome120' : 'safari16',
    rolldownOptions: {
      input: { main: page('index.html'), pet: page('pet.html') },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
