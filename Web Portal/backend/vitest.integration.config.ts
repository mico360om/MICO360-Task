import { defineConfig } from 'vitest/config';

// Database integration tests — require a running MySQL (TEST_DATABASE_URL).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
