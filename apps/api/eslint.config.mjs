import { nest } from '@wishlist/config/eslint/nest';

export default [
  { ignores: ['openapi.json', 'prisma/migrations/**'] },
  ...nest({ tsconfigRootDir: import.meta.dirname }),
];
