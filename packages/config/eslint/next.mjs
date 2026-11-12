import nextPlugin from '@next/eslint-plugin-next';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { base } from './base.mjs';

/**
 * Application Next.js : socle + React, accessibilité, règles de apps/web/CLAUDE.md.
 * @param {{ tsconfigRootDir: string }} opts
 */
export function next({ tsconfigRootDir }) {
  return tseslint.config(
    ...base({ tsconfigRootDir }),
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: { globals: { ...globals.browser, ...globals.node } },
      settings: { react: { version: 'detect' } },
      plugins: {
        react,
        'react-hooks': reactHooks,
        'jsx-a11y': jsxA11y,
        '@next/next': nextPlugin,
      },
      rules: {
        ...react.configs.recommended.rules,
        ...react.configs['jsx-runtime'].rules,
        ...reactHooks.configs.recommended.rules,
        ...jsxA11y.configs.strict.rules,
        ...nextPlugin.configs.recommended.rules,
        ...nextPlugin.configs['core-web-vitals'].rules,
        // Contenu externe = donnée (invariant 6) : jamais de HTML injecté.
        'react/no-danger': 'error',
        'react/jsx-no-target-blank': ['error', { enforceDynamicLinks: 'always' }],
        'no-restricted-syntax': [
          'error',
          {
            selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
            message: 'Jamais de dangerouslySetInnerHTML (invariant 6).',
          },
        ],
        'no-restricted-globals': [
          'error',
          { name: 'localStorage', message: 'Rien de sensible dans localStorage (08).' },
          { name: 'sessionStorage', message: 'Rien de sensible dans sessionStorage (08).' },
        ],
        '@typescript-eslint/no-misused-promises': [
          'error',
          { checksVoidReturn: { attributes: false } },
        ],
      },
    },
    {
      // Données : uniquement par les hooks générés de @wishlist/api-client.
      files: ['src/**/*.{ts,tsx}'],
      ignores: ['src/lib/api/**'],
      rules: {
        'no-restricted-globals': [
          'error',
          { name: 'fetch', message: 'Passer par les hooks de @wishlist/api-client.' },
          { name: 'localStorage', message: 'Rien de sensible dans localStorage (08).' },
          { name: 'sessionStorage', message: 'Rien de sensible dans sessionStorage (08).' },
        ],
      },
    },
  );
}
