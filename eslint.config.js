// Flat config, scoped to match package.json's `scripts.lint` glob.
// Baseline recommended rules only — see CLAUDE audit notes for why this
// isn't tightened further on the first pass.
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'apps/**/*.ts', 'libs/**/*.ts', 'test/**/*.ts'],
    rules: {
      // Nest constructors and DI-heavy code rely on this pattern throughout.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
