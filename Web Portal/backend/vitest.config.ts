import { defineConfig } from 'vitest/config';

// Default suite = fast unit tests (no database required).
// Database integration tests live in tests/integration and run via `npm run test:db`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'tests/integration/**'],
    clearMocks: true,
    // zod 4 keeps the API's words for a failed check (src/lib/zod-messages.ts; the server loads it too).
    setupFiles: ['./src/lib/zod-messages.ts'],
    // Generous timeout: these are fast in-memory tests, but slow disks (e.g. a
    // synced/AV-scanned checkout) can make app bootstrap exceed the 5s default.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
