import { defineConfig } from 'vitest/config';

// Unit tests for the framework-agnostic core (src/lib, src/**). Pure TS — no
// React Native runtime required, so these run in Node during Phase-2 development.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
