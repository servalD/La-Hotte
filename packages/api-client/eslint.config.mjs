import { base } from '@wishlist/config/eslint/base';

export default [
  // Code généré : vérifié par la CI (pnpm generate sans différence), pas par le lint.
  { ignores: ['src/generated/**'] },
  ...base({ tsconfigRootDir: import.meta.dirname }),
];
