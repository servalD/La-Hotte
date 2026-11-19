// Élagage des node_modules livrés (DEP-08). Usage :
//   node prune-node-modules.mjs <racine> [bundlers] [prisma-cli]
//
// 1. Retire du magasin pnpm (`<racine>/node_modules/.pnpm`) :
//    - toujours, les variantes musl : les images sont en glibc, ces binaires ne s'y chargent jamais ;
//    - `bundlers` : l'outillage de construction que `@sentry/node > @sentry/bundler-plugins` fait
//      installer en dépendances de pair (webpack, swc, esbuild, lightningcss, CLI sentry) ;
//    - `prisma-cli` : la CLI Prisma et TypeScript, que `@prisma/client` tire en dépendances de pair ;
//      l'API n'en a pas besoin (client déjà généré, migrations dans l'image `migrate`).
// 2. Retire les liens pendants, puis les paquets du magasin qu'aucun lien ne rend plus atteignables
//    depuis les dépendances directes (ce que tiraient seuls les paquets retirés).
// 3. Retire les fichiers jamais chargés à l'exécution : déclarations TypeScript, cartes de source et
//    documentation des dépendances (les cartes du code de l'application, hors node_modules, restent).
//
// À vérifier en démarrant la pile complète à chaque montée de `@sentry/*` ou de Prisma.
import { lstatSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const [root, ...modes] = process.argv.slice(2);
const DROP = {
  always: [/musl/],
  bundlers: [
    /^webpack@/,
    /^@swc\+core/,
    /^@esbuild\+/,
    /^esbuild@/,
    /^lightningcss/,
    /^@sentry\+cli/,
  ],
  'prisma-cli': [/^prisma@/, /^typescript@/],
};
const DEAD_FILE = /(\.d\.[cm]?ts|\.map|\.md|\.markdown)$|^(CHANGELOG|HISTORY|AUTHORS)(\..*)?$/i;

if (!root) fail('usage : prune-node-modules.mjs <racine> [bundlers] [prisma-cli]');
for (const mode of modes) if (!DROP[mode]) fail(`mode inconnu : ${mode}`);
const store = join(root, 'node_modules', '.pnpm');
if (!isDir(store)) fail(`${store} introuvable`);

const patterns = [...DROP.always, ...modes.flatMap((mode) => DROP[mode])];
const entries = () =>
  readdirSync(store).filter((name) => name !== 'node_modules' && !name.startsWith('.'));
let dropped = 0;
for (const name of entries()) {
  if (patterns.some((pattern) => pattern.test(name))) {
    rmSync(join(store, name), { recursive: true, force: true });
    dropped += 1;
  }
}
removeDanglingLinks(join(root, 'node_modules'));

// Atteignabilité : racines = liens hors du magasin (dépendances directes), arêtes = liens d'une
// entrée du magasin vers une autre. Le dossier `.pnpm/node_modules` (remontée de pnpm) n'est pas une
// racine : il pointe vers tout le magasin.
const reachable = new Set();
const queue = [];
const visit = (link) => {
  const entry = storeEntryOf(link);
  if (entry && !reachable.has(entry)) {
    reachable.add(entry);
    queue.push(entry);
  }
};
for (const link of links(root, (dir) => dir === store)) visit(link);
while (queue.length > 0) {
  const entry = queue.pop();
  for (const link of links(join(store, entry, 'node_modules'), () => false)) visit(link);
}
let collected = 0;
for (const name of entries()) {
  if (!reachable.has(name)) {
    rmSync(join(store, name), { recursive: true, force: true });
    collected += 1;
  }
}
removeDanglingLinks(join(root, 'node_modules'));

let files = 0;
walk(join(root, 'node_modules'), (path, name, stat) => {
  if (stat.isFile() && DEAD_FILE.test(name) && !/^license/i.test(name)) {
    rmSync(path);
    files += 1;
  }
});
console.log(
  `prune : ${dropped} paquets retirés, ${collected} devenus inatteignables, ${files} fichiers morts`,
);

function storeEntryOf(link) {
  let target;
  try {
    target = realpathSync(link);
  } catch {
    return undefined;
  }
  const rel = relative(store, target);
  if (rel.startsWith('..') || rel === '') return undefined;
  return rel.split(sep)[0];
}

// Liens symboliques sous `dir`, sans suivre les liens ni descendre dans les dossiers exclus.
function links(dir, skip) {
  const found = [];
  walk(
    dir,
    (path, _name, stat) => {
      if (stat.isSymbolicLink()) found.push(path);
    },
    skip,
  );
  return found;
}

// Liens pendants, et liens qui sortent de la racine (paquet de l'espace de travail vers `/repo`) :
// ils pendraient dans l'image livrée.
function removeDanglingLinks(dir) {
  const top = realpathSync(root);
  walk(dir, (path, _name, stat) => {
    if (!stat.isSymbolicLink()) return;
    try {
      statSync(path);
      if (relative(top, realpathSync(path)).startsWith('..')) rmSync(path);
    } catch {
      rmSync(path);
    }
  });
}

function walk(dir, onEntry, skip = () => false) {
  if (!isDir(dir) || skip(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    onEntry(path, name, stat);
    if (stat.isDirectory()) walk(path, onEntry, skip);
  }
}

function isDir(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`prune : ${message}`);
  process.exit(1);
}
