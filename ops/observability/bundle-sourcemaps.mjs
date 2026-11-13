#!/usr/bin/env node
// OBS-30, OBS-31, OBS-34 : cartes de source du navigateur vers GlitchTip, au déploiement seulement.
//
//   node ops/observability/bundle-sourcemaps.mjs upload <dossier> [--url-prefix ~/_next/static]
//   node ops/observability/bundle-sourcemaps.mjs strip  <dossier>
//   node ops/observability/bundle-sourcemaps.mjs check  <dossier>
//
// `upload` attend un dossier déjà passé par `glitchtip-cli sourcemaps inject` (OBS-35). Il fabrique
// le bundle d'artefacts (zip + manifest.json), l'envoie par le protocole d'envoi par morceaux,
// demande l'assemblage, puis interroge GlitchTip jusqu'à y trouver chaque fichier attendu : sans
// cela le déploiement échoue (OBS-34). `glitchtip-cli sourcemaps upload` 1.0.0 n'est pas utilisé :
// il envoie les fichiers bruts, que le serveur rejette, et retourne un succès (ADR 0012).
// `strip` retire les cartes et leurs références de ce qui sera servi ; `check` échoue s'il en reste.
//
// Variables de `upload` : GLITCHTIP_URL (URL réelle de GlitchTip, OBS-35), GLITCHTIP_AUTH_TOKEN,
// GLITCHTIP_ORG, GLITCHTIP_PROJECT, RELEASE (SHA du commit, OBS-13). Le jeton n'est jamais écrit ;
// une erreur nomme l'étape et le code HTTP, jamais un corps de réponse.
//
// Aucune dépendance : Node 22 (fetch, FormData, zlib.crc32). Le script est à supprimer quand une
// version de la CLI aura été vérifiée de bout en bout (OBS-31).

import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';

const DEBUG_ID_COMMENT = /\/\/# debugId=([0-9a-fA-F-]{36})\s*$/;
// Ligne de fin de fichier que `strip` retire : commentaire de carte seul sur sa ligne.
const SOURCE_MAPPING_LINE =
  /^[ \t]*(?:\/\/[#@] sourceMappingURL=.*|\/\*[#@] sourceMappingURL=.*?\*\/)[ \t]*$/;
// Ce que `check` refuse, où que ce soit : plus large que ce que `strip` sait retirer, pour qu'une
// référence placée ailleurs (après du code, carte intégrée en `data:`) fasse échouer au lieu de
// passer en silence.
const SOURCE_MAPPING_ANYWHERE = /sourceMappingURL\s*=/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHA = /^[0-9a-f]{7,40}$/;
const REQUEST_TIMEOUT_MS = 60_000;

export class SourcemapError extends Error {
  name = 'SourcemapError';
}

// ---------------------------------------------------------------------------------------------
// Fichiers

/**
 * Chemins relatifs (séparateur `/`) sous `root`, triés : fichiers réguliers d'un côté, tout le
 * reste (liens symboliques, sockets…) de l'autre. Les liens ne sont jamais suivis.
 */
export async function listEntries(root) {
  const files = [];
  const others = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const path = relative(root, full).split(sep).join('/');
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push(path);
      else others.push(path);
    }
  }
  await walk(root);
  return { files: files.sort(), others: others.sort() };
}

export async function listFiles(root) {
  return (await listEntries(root)).files;
}

function debugIdOfScript(text) {
  const match = DEBUG_ID_COMMENT.exec(text.trimEnd());
  return match ? match[1].toLowerCase() : undefined;
}

function debugIdOfMap(bytes) {
  try {
    const map = JSON.parse(bytes.toString('utf8'));
    const id = map.debug_id ?? map.debugId;
    return typeof id === 'string' ? id.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Paires (script, carte) d'un dossier passé par `inject`. Un script sans carte voisine est ignoré
 * (Next en produit quelques-uns) ; un script avec carte mais sans identifiant de débogage, ou dont la
 * carte porte un autre identifiant, fait échouer : `inject` n'a pas été appliqué à ce build.
 */
export async function collectArtifacts(root) {
  const files = await listFiles(root);
  const present = new Set(files);
  const artifacts = [];
  for (const path of files) {
    if (!path.endsWith('.js') || !present.has(`${path}.map`)) continue;
    const script = await readFile(join(root, path));
    const map = await readFile(join(root, `${path}.map`));
    const debugId = debugIdOfScript(script.toString('utf8'));
    if (!debugId || !UUID.test(debugId)) {
      throw new SourcemapError(
        `Pas d'identifiant de débogage dans ${path} : lancer d'abord glitchtip-cli sourcemaps inject.`,
      );
    }
    if (debugIdOfMap(map) !== debugId) {
      throw new SourcemapError(`La carte de ${path} ne porte pas le même identifiant de débogage.`);
    }
    artifacts.push({ path, debugId, script, map });
  }
  if (artifacts.length === 0) {
    throw new SourcemapError(
      'Aucune paire script et carte : le build a-t-il été fait avec BROWSER_SOURCEMAPS=true ?',
    );
  }
  return artifacts;
}

/** Manifeste attendu par `assemble_artifacts` de GlitchTip 7 (apps/files/assemble.py). */
export function buildManifest({ org, release, urlPrefix, artifacts }) {
  const prefix = urlPrefix.replace(/\/+$/, '');
  const files = {};
  for (const { path, debugId } of artifacts) {
    const base = path.split('/').pop();
    files[`files/${path}`] = {
      url: `${prefix}/${path}`,
      type: 'minified_source',
      headers: { 'debug-id': debugId, Sourcemap: `${base}.map` },
    };
    files[`files/${path}.map`] = {
      url: `${prefix}/${path}.map`,
      type: 'source_map',
      headers: { 'debug-id': debugId },
    };
  }
  return { org, release, files };
}

// ---------------------------------------------------------------------------------------------
// Zip minimal (deflate, sans extension), déterministe : date fixe, entrées dans l'ordre donné.

const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const DOS_TIME = 0;

export function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version nécessaire
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  if (offset > 0xffffffff || entries.length > 0xffff) {
    throw new SourcemapError('Bundle trop gros pour un zip sans Zip64.');
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function buildBundle({ org, release, urlPrefix, artifacts }) {
  const manifest = buildManifest({ org, release, urlPrefix, artifacts });
  const entries = [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest), 'utf8') }];
  for (const { path, script, map } of artifacts) {
    entries.push({ name: `files/${path}`, data: script });
    entries.push({ name: `files/${path}.map`, data: map });
  }
  return createZip(entries);
}

export const sha1 = (bytes) => createHash('sha1').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------
// Configuration

export function readConfig(env) {
  const missing = [
    'GLITCHTIP_URL',
    'GLITCHTIP_AUTH_TOKEN',
    'GLITCHTIP_ORG',
    'GLITCHTIP_PROJECT',
    'RELEASE',
  ].filter((name) => !env[name]);
  if (missing.length > 0) throw new SourcemapError(`Variables manquantes : ${missing.join(', ')}.`);

  let base;
  try {
    base = new URL(env.GLITCHTIP_URL);
  } catch {
    throw new SourcemapError('GLITCHTIP_URL invalide.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  // Le jeton part dans chaque requête : jamais en clair hors de la machine.
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) {
    throw new SourcemapError('GLITCHTIP_URL doit être en https (http seulement pour localhost).');
  }
  if (base.username || base.password || base.search || base.hash) {
    throw new SourcemapError(
      'GLITCHTIP_URL ne doit porter ni identifiants, ni chaîne de requête, ni fragment.',
    );
  }
  for (const name of ['GLITCHTIP_ORG', 'GLITCHTIP_PROJECT']) {
    if (!SLUG.test(env[name])) throw new SourcemapError(`${name} invalide.`);
  }
  if (!SHA.test(env.RELEASE)) throw new SourcemapError('RELEASE invalide (SHA du commit attendu).');

  return {
    baseUrl: base.href.replace(/\/+$/, ''),
    origin: base.origin,
    token: env.GLITCHTIP_AUTH_TOKEN,
    org: env.GLITCHTIP_ORG,
    project: env.GLITCHTIP_PROJECT,
    release: env.RELEASE,
  };
}

// ---------------------------------------------------------------------------------------------
// GlitchTip

function client(config, fetchImpl) {
  return async function call(step, url, init = {}) {
    const target = new URL(url, `${config.baseUrl}/`);
    // OBS-35 : comme la CLI, ne jamais envoyer le jeton à un autre hôte que celui configuré, même si
    // le serveur l'indique (adresse d'envoi des morceaux, lien de page suivante).
    if (target.origin !== config.origin) {
      throw new SourcemapError(
        `${step} : GlitchTip indique un autre hôte que GLITCHTIP_URL (OBS-35).`,
      );
    }
    let response;
    try {
      response = await fetchImpl(target, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { ...init.headers, Authorization: `Bearer ${config.token}` },
      });
    } catch (error) {
      throw new SourcemapError(`${step} : GlitchTip injoignable (${error?.name ?? 'erreur'}).`);
    }
    if (!response.ok) throw new SourcemapError(`${step} : réponse ${response.status}.`);
    return response;
  };
}

function nextLink(header) {
  if (!header) return undefined;
  for (const part of header.split(',')) {
    const url = /<([^>]+)>/.exec(part)?.[1];
    if (url && /rel="next"/.test(part) && /results="true"/.test(part)) return url;
  }
  return undefined;
}

/** Fichiers de la release côté serveur, toutes pages suivies. */
async function listReleaseFiles(call, config) {
  const rows = [];
  let url = `api/0/organizations/${config.org}/releases/${config.release}/files/`;
  for (let page = 0; url && page < 100; page++) {
    const response = await call('Lecture des fichiers de la release', url);
    const body = await response.json();
    if (!Array.isArray(body))
      throw new SourcemapError('Lecture des fichiers de la release : réponse inattendue.');
    rows.push(...body);
    url = nextLink(response.headers.get('link'));
  }
  return rows;
}

/**
 * OBS-34 : chaque script attendu est-il stocké, avec son identifiant de débogage et son contenu ?
 * La liste ne montre que le script d'un couple lié à sa carte ; une carte qui apparaît seule n'a
 * pas été liée et ne servira à rien.
 */
export function missingArtifacts(expected, rows) {
  const byDebugId = new Map();
  for (const row of rows) {
    const id = row?.headers?.['debug-id'];
    if (typeof id === 'string') byDebugId.set(id.toLowerCase(), row);
  }
  return expected.filter(({ path, debugId, script }) => {
    const row = byDebugId.get(debugId);
    return !row || row.name !== path.split('/').pop() || row.sha1 !== sha1(script);
  });
}

export async function upload({
  root,
  urlPrefix,
  env,
  fetchImpl = fetch,
  log = console.log,
  pollIntervalMs = 3000,
  pollTimeoutMs = 180_000,
}) {
  const config = readConfig(env);
  const call = client(config, fetchImpl);
  const artifacts = await collectArtifacts(root);
  const bundle = buildBundle({ org: config.org, release: config.release, urlPrefix, artifacts });
  const checksum = sha1(bundle);
  log(`${artifacts.length} script(s) avec carte, bundle de ${bundle.length} octets.`);

  // Release rattachée au projet, pour qu'elle apparaisse dans GlitchTip (l'assemblage la créerait
  // sinon sans projet).
  await call('Création de la release', `api/0/organizations/${config.org}/releases/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: config.release, projects: [config.project] }),
  });

  const info = await (
    await call('Paramètres d’envoi', `api/0/organizations/${config.org}/chunk-upload/`)
  ).json();
  const chunkSize = Number(info?.chunkSize);
  if (!Number.isInteger(chunkSize) || chunkSize <= 0)
    throw new SourcemapError('Paramètres d’envoi : taille de morceau absente.');
  if (info.hashAlgorithm !== 'sha1' || !info.compression?.includes('gzip')) {
    throw new SourcemapError(
      'Paramètres d’envoi : GlitchTip attend un autre format (sha1 et gzip requis).',
    );
  }
  if (Array.isArray(info.accept) && !info.accept.includes('artifact_bundles')) {
    throw new SourcemapError(
      'Paramètres d’envoi : GlitchTip n’accepte pas les bundles d’artefacts.',
    );
  }
  if (typeof info.url !== 'string')
    throw new SourcemapError('Paramètres d’envoi : adresse absente.');
  const chunkUrl = info.url.endsWith('/') ? info.url : `${info.url}/`;

  // Un morceau par requête : GlitchTip 7 n'en accepte pas davantage (chunksPerRequest = 1).
  const chunks = [];
  for (let start = 0; start < bundle.length; start += chunkSize) {
    const chunk = bundle.subarray(start, start + chunkSize);
    const name = sha1(chunk);
    chunks.push(name);
    const form = new FormData();
    form.append('file_gzip', new Blob([gzipSync(chunk)]), name);
    await call('Envoi d’un morceau', chunkUrl, { method: 'POST', body: form });
  }

  const assembleUrl = `api/0/organizations/${config.org}/releases/${config.release}/assemble/`;
  const assembled = await (
    await call('Assemblage', assembleUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checksum, chunks }),
    })
  ).json();
  if (assembled?.missingChunks?.length)
    throw new SourcemapError('Assemblage : morceaux manquants côté serveur.');
  if (assembled?.state === 'error' || assembled?.state === 'not_found') {
    throw new SourcemapError(`Assemblage : état ${assembled.state}.`);
  }

  // L'assemblage est asynchrone et GlitchTip n'en relit pas l'état : seule la liste des fichiers
  // fait foi (OBS-34).
  const deadline = Date.now() + pollTimeoutMs;
  for (;;) {
    const missing = missingArtifacts(artifacts, await listReleaseFiles(call, config));
    if (missing.length === 0) break;
    if (Date.now() >= deadline) {
      throw new SourcemapError(
        `Vérification : ${missing.length} script(s) sur ${artifacts.length} absents de GlitchTip après assemblage.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  log(
    `Vérifié côté serveur : ${artifacts.length} script(s) et leurs cartes dans la release ${config.release}.`,
  );
  return { artifacts: artifacts.length, checksum, chunks: chunks.length };
}

// ---------------------------------------------------------------------------------------------
// Retrait et contrôle (OBS-30)

const TEXT_ASSET = /\.(?:m?js|css)$/;

/**
 * Retire les commentaires de carte de la fin du fichier seulement, là où les placent webpack et
 * `inject` : on remonte depuis la fin à travers les lignes vides, de carte et d'identifiant de
 * débogage. Une ligne semblable au milieu du code (dans une chaîne, par exemple) n'est pas touchée ;
 * `check` la signalera.
 */
export function stripTrailingReferences(text) {
  const lines = text.split('\n');
  let changed = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].replace(/\r$/, '');
    if (SOURCE_MAPPING_LINE.test(line)) {
      lines.splice(i, 1);
      changed = true;
    } else if (line.trim() !== '' && !DEBUG_ID_COMMENT.test(line)) {
      break;
    }
  }
  return changed ? lines.join('\n') : text;
}

export async function strip(root) {
  let removed = 0;
  let rewritten = 0;
  for (const path of await listFiles(root)) {
    const full = join(root, path);
    if (path.endsWith('.map')) {
      await rm(full);
      removed++;
    } else if (TEXT_ASSET.test(path)) {
      const text = await readFile(full, 'utf8');
      const next = stripTrailingReferences(text);
      if (next !== text) {
        await writeFile(full, next);
        rewritten++;
      }
    }
  }
  return { removed, rewritten };
}

/**
 * Ce qui trahirait une carte dans un dossier servi : fichier `.map`, mention de `sourceMappingURL`
 * où que ce soit dans un script ou une feuille de style (carte intégrée en `data:` comprise), et
 * toute entrée qui n'est ni fichier ni dossier (un lien pourrait désigner une carte).
 */
export async function findLeftovers(root) {
  const { files, others } = await listEntries(root);
  const leftovers = [...others];
  for (const path of files) {
    if (path.endsWith('.map')) leftovers.push(path);
    else if (TEXT_ASSET.test(path)) {
      if (SOURCE_MAPPING_ANYWHERE.test(await readFile(join(root, path), 'utf8'))) {
        leftovers.push(path);
      }
    }
  }
  return leftovers.sort();
}

// ---------------------------------------------------------------------------------------------

const USAGE =
  'Usage : bundle-sourcemaps.mjs upload <dossier> [--url-prefix ~/_next/static]\n' +
  '        bundle-sourcemaps.mjs strip <dossier>\n' +
  '        bundle-sourcemaps.mjs check <dossier> [<dossier>…]';

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const roots = [];
  let urlPrefix = '~/_next/static';
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--url-prefix' && command === 'upload' && rest[i + 1]) urlPrefix = rest[++i];
    else if (rest[i].startsWith('--')) throw new SourcemapError(`Argument inconnu : ${rest[i]}`);
    else roots.push(rest[i]);
  }
  const arity = command === 'check' ? roots.length >= 1 : roots.length === 1;
  if (!['upload', 'strip', 'check'].includes(command) || !arity) throw new SourcemapError(USAGE);
  return { command, roots, urlPrefix };
}

async function main() {
  const { command, roots, urlPrefix } = parseArgs(process.argv.slice(2));
  // Un dossier absent fait échouer, `check` compris : jamais de vert sur un mauvais chemin.
  for (const root of roots) {
    if (!(await lstat(root).catch(() => undefined))?.isDirectory()) {
      throw new SourcemapError(`Dossier introuvable : ${root}`);
    }
  }
  if (command === 'upload') {
    await upload({ root: roots[0], urlPrefix, env: process.env });
  } else if (command === 'strip') {
    const { removed, rewritten } = await strip(roots[0]);
    console.log(`${removed} carte(s) supprimée(s), ${rewritten} référence(s) retirée(s).`);
  } else {
    const leftovers = [];
    for (const root of roots) {
      for (const path of await findLeftovers(root)) leftovers.push(`${root}/${path}`);
    }
    if (leftovers.length > 0) {
      throw new SourcemapError(
        `Cartes ou références restantes (OBS-30) :\n  ${leftovers.join('\n  ')}`,
      );
    }
    console.log('Aucune carte ni référence de carte (OBS-30).');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Nos messages sont écrits pour être affichés ; une autre erreur n'est décrite que par son type.
    console.error(
      error instanceof SourcemapError
        ? error.message
        : `Échec inattendu (${error?.name ?? 'erreur'}).`,
    );
    process.exit(1);
  });
}
