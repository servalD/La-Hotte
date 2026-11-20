// DEP-04 : paquet minimal de l'image de migration, avec la CLI Prisma à la version exacte de la
// construction. Usage : node migrate-package.mjs <package.json de prisma> <sortie>
import { readFileSync, writeFileSync } from 'node:fs';

const [source, target] = process.argv.slice(2);
const { version } = JSON.parse(readFileSync(source, 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('version de Prisma inattendue');
writeFileSync(
  target,
  JSON.stringify({
    name: 'migrate',
    private: true,
    dependencies: { prisma: version },
    // pnpm 10 n'exécute les scripts d'installation que des paquets nommés : le moteur de Prisma
    // se télécharge à l'installation.
    // effect (tiré par @prisma/config) : ReDoS corrigé en 3.22.1 (GHSA-7589-6fvf-x4pw), comme dans
    // pnpm-workspace.yaml ; la série 4 casse la CLI.
    pnpm: {
      onlyBuiltDependencies: ['prisma', '@prisma/engines'],
      overrides: { effect: '>=3.22.1 <4' },
    },
  }),
);
