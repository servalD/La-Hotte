// QA-03, critère de 14 : « une branche qui importe Prisma depuis un dossier domain échoue en CI ».
// Écrit temporairement des fichiers fautifs dans apps/api, vérifie que le lint réel les refuse.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const api = join(import.meta.dirname, '..', 'apps', 'api');
const canaries = [
  {
    file: 'src/modules/example/domain/__canary_prisma__.ts',
    code: "import { PrismaClient } from '@prisma/client';\nexport const c = PrismaClient;\n",
  },
  {
    file: 'src/modules/__canary__/application/__canary_cross__.ts',
    code: "import { ExampleItem } from '../../example/domain/example-item';\nexport const c = ExampleItem;\n",
  },
];

let failed = false;
try {
  for (const { file, code } of canaries) {
    mkdirSync(dirname(join(api, file)), { recursive: true });
    writeFileSync(join(api, file), code);
  }
  for (const { file } of canaries) {
    const run = spawnSync('pnpm', ['exec', 'eslint', '--no-warn-ignored', file], {
      cwd: api,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    const refused = run.status !== 0 && run.stdout.includes('architecture/layers');
    console.log(`${refused ? 'refusé (attendu)' : 'ACCEPTÉ (anormal)'} : ${file}`);
    if (!refused) failed = true;
  }
} finally {
  for (const { file } of canaries) rmSync(join(api, file), { force: true });
  rmSync(join(api, 'src/modules/__canary__'), { recursive: true, force: true });
}

if (failed) {
  console.error('La règle d’architecture ne bloque plus un import interdit.');
  process.exit(1);
}
