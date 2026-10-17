import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { precompress } from './src/tooling/precompress';
import { buildInfo } from './src/tooling/build-info';

// This build's version (package.json, set by tools/release/release.mjs) and the time it was made:
// compiled into the app and published as build-info.json, never taken from a browser's clock.
const version = (JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;
const builtAt = new Date().toISOString();

export default defineConfig({
  // precompress: .br/.gz copies of the built scripts and styles, served by the API's own web server.
  plugins: [react(), precompress(), buildInfo({ version, builtAt })],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILT_AT__: JSON.stringify(builtAt),
  },
  // Keep Vite's dependency cache out of the Dropbox-synced project folder,
  // otherwise Dropbox locks node_modules/.vite and dep optimization fails (EBUSY).
  cacheDir: path.join(os.tmpdir(), 'mico360-vite-cache'),
  // Dev proxy: forward API / realtime / uploads to the backend so the app can call them
  // same-origin (set VITE_API_URL=/api/v1 in .env.local). This avoids cross-origin/CORS and works
  // inside sandboxed preview browsers that block a page on one port from fetching another port.
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', changeOrigin: true, ws: true },
      '/uploads': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    // Split large third-party deps into their own cached chunks so a return visit on a slow
    // connection only re-downloads the app code that changed, not the whole framework.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          // The rich-text editor (meeting notes) and what it is built on: loaded with the meeting
          // page only. First, so @tiptap/react doesn't land in vendor-react (its path has /react/).
          if (/[\/](@tiptap|prosemirror-[^\/]+|orderedmap|rope-sequence|w3c-keyname|linkifyjs)[\/]/.test(id)) return 'vendor-editor';
          // Only the leaf framework (react/react-dom/scheduler) goes in its own chunk — putting
          // react-router here creates a circular chunk with the rest of vendor.
          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (id.includes('@tanstack')) return 'vendor-query';
          if (id.includes('socket.io') || id.includes('engine.io')) return 'vendor-realtime';
          return 'vendor';
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
