import globals from 'globals';
import tseslint from 'typescript-eslint';
import architecture from './rules/architecture.mjs';
import { base } from './base.mjs';

/**
 * API NestJS : socle + règles d'architecture bloquantes (QA-03).
 * @param {{ tsconfigRootDir: string, domainAllowedPackages?: string[] }} opts
 */
export function nest({ tsconfigRootDir, domainAllowedPackages = [] }) {
  return tseslint.config(
    ...base({ tsconfigRootDir }),
    {
      languageOptions: { globals: globals.node },
      plugins: { architecture },
      rules: {
        'architecture/layers': ['error', { domainAllowedPackages }],
        // Les classes NestJS injectent par constructeur et décorent des propriétés.
        '@typescript-eslint/parameter-properties': 'off',
        // Injection : les types des paramètres doivent rester des valeurs à l'exécution.
        '@typescript-eslint/consistent-type-imports': 'off',
      },
    },
    {
      files: ['src/**/domain/**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'Decorator',
            message: 'Le domaine reste du TypeScript pur : pas de décorateur (ADR 0002).',
          },
        ],
      },
    },
    {
      // Les tests câblent librement les adaptateurs (ports en mémoire, dépôts réels).
      files: ['**/*.spec.ts', '**/*.int-spec.ts', 'test/**/*.ts'],
      rules: {
        'architecture/layers': 'off',
        '@typescript-eslint/unbound-method': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
      },
    },
  );
}
