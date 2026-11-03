import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // dist-*: other builds kept beside dist (a battery snapshot, the upgrade rehearsal's dist-up).
  { ignores: ['dist/**', 'dist-*/**', 'node_modules/**', 'prisma/migrations/**', 'src/generated/**', 'e2e/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
