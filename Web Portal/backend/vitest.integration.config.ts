import { defineConfig } from 'vitest/config';

// Database integration tests — require a running MySQL (TEST_DATABASE_URL).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    fileParallelism: false,
    // zod 4 keeps the API's words for a failed check (src/lib/zod-messages.ts; the server loads it too).
    setupFiles: ['./src/lib/zod-messages.ts'],
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
