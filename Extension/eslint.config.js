// Lint for the Chrome extension (plain ES modules, no build step): `npm run lint` in Extension/, or
// `npm run lint` at the repo root with the other workspaces. Uses the ESLint the web app installs.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // The app page and the shared modules run in an extension page: the DOM plus chrome.*.
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules: {
      // `const { a, ...rest } = x` leaves out `a` on purpose.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      eqeqeq: ['error', 'smart'],
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // Manifest V3 forbids remote and generated code; screens build the DOM with el(), never HTML strings.
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'Build the DOM with el() (app/dom.js); never assign HTML.' },
        { property: 'outerHTML', message: 'Build the DOM with el() (app/dom.js); never assign HTML.' },
        { object: 'document', property: 'write', message: 'Not allowed in an extension page.' },
      ],
    },
  },
  {
    files: ['background/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.webextensions } },
  },
  {
    // Tests and tooling run in Node (DOM tests get jsdom from Vitest).
    files: ['src/**/*.test.js', 'src/test-helpers.js', '*.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-restricted-properties': 'off' },
  },
];
