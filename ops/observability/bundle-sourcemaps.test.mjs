// OBS-30, OBS-31, OBS-34, OBS-35 : tests du script d'envoi des cartes. `pnpm test:ops`.
// Le faux GlitchTip rassemble réellement les morceaux reçus, relit le zip et son manifeste, et ne
// liste que ce qu'il a pu en tirer : un bundle mal formé ou incomplet ne passe pas la vérification.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { crc32, gunzipSync, inflateRawSync } from 'node:zlib';

import {
  buildBundle,
  collectArtifacts,
  findLeftovers,
  missingArtifacts,
  parseArgs,
  readConfig,
  sha1,
  SourcemapError,
  strip,
  upload,
} from './bundle-sourcemaps.mjs';

const TOKEN = 'jeton-secret-ne-doit-jamais-sortir';
const BASE = 'https://glitchtip.example.test';
const SHA = 'c999b5cfb883fceb9385b0aeb33b641e8734f6e2';
const ENV = {
  GLITCHTIP_URL: BASE,
  GLITCHTIP_AUTH_TOKEN: TOKEN,
  GLITCHTIP_ORG: 'wishlist',
  GLITCHTIP_PROJECT: 'wishlist-web',
  RELEASE: SHA,
};
const ID_A = '3aa10fbd-0e88-54e6-861b-801b25b7181b';
const ID_B = '7978e21a-d5a5-50ca-af79-a29e3d498c1d';

/** Lecteur de zip minimal : répertoire central, inflate, contrôle du CRC. */
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'fin de répertoire central absente');
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    const crc = buffer.readUInt32LE(cursor + 16);
    const size = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const local = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(local + 26);
    const start = local + 30 + localNameLength;
    const data = inflateRawSync(buffer.subarray(start, start + size));
    assert.equal(crc32(data), crc, `CRC de ${name}`);
    entries.set(name, data);
    cursor += 46 + nameLength;
  }
  return entries;
}

function script(name, debugId) {
  const body = `console.log(${JSON.stringify(name)});\n//# sourceMappingURL=${name}.map\n`;
  return debugId ? `${body}//# debugId=${debugId}\n` : body;
}

function sourceMap(debugId) {
  return JSON.stringify({
    version: 3,
    sources: ['../src/a.ts'],
    mappings: 'AAAA',
    debug_id: debugId,
  });
}

async function makeBuild(root, { injected = true } = {}) {
  await mkdir(join(root, 'chunks/app'), { recursive: true });
  await mkdir(join(root, 'css'), { recursive: true });
  await writeFile(join(root, 'chunks/main-1.js'), script('main-1.js', injected && ID_A));
  await writeFile(join(root, 'chunks/main-1.js.map'), sourceMap(injected ? ID_A : undefined));
  await writeFile(join(root, 'chunks/app/page-2.js'), script('page-2.js', injected && ID_B));
  await writeFile(join(root, 'chunks/app/page-2.js.map'), sourceMap(injected ? ID_B : undefined));
  // Sans carte voisine : ignoré par l'envoi.
  await writeFile(join(root, 'chunks/polyfills.js'), 'void 0;\n');
  await writeFile(join(root, 'css/app.css'), 'a{color:red}\n/*# sourceMappingURL=app.css.map*/\n');
  await writeFile(join(root, 'css/app.css.map'), '{}');
}

/** Faux GlitchTip 7 : mêmes routes et mêmes contraintes que l'essai (un morceau par requête). */
function fakeGlitchTip({
  chunkUrl = `${BASE}/api/0/organizations/wishlist/chunk-upload/`,
  chunkSize = 64,
  store = true,
  tamper,
  nextBase = BASE,
} = {}) {
  const blobs = new Map();
  let rows = [];
  const calls = [];
  async function fetchImpl(url, init = {}) {
    const target = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({
      origin: target.origin,
      path: target.pathname + target.search,
      method,
      auth: init.headers?.Authorization,
    });
    if (init.headers?.Authorization !== `Bearer ${TOKEN}`) return new Response('', { status: 401 });
    const path = target.pathname;
    if (method === 'POST' && path === '/api/0/organizations/wishlist/releases/') {
      const body = JSON.parse(init.body);
      assert.deepEqual(body, { version: SHA, projects: ['wishlist-web'] });
      return Response.json({}, { status: 201 });
    }
    if (method === 'GET' && path === '/api/0/organizations/wishlist/chunk-upload/') {
      return Response.json({
        url: chunkUrl,
        chunkSize,
        chunksPerRequest: 1,
        hashAlgorithm: 'sha1',
        compression: ['gzip'],
        accept: ['artifact_bundles'],
      });
    }
    if (method === 'POST' && path === '/api/0/organizations/wishlist/chunk-upload/') {
      const files = init.body.getAll('file_gzip');
      assert.equal(files.length, 1, 'un seul morceau par requête');
      const data = gunzipSync(Buffer.from(await files[0].arrayBuffer()));
      assert.ok(data.length <= chunkSize);
      if (sha1(data) !== files[0].name) return new Response('', { status: 400 });
      blobs.set(files[0].name, data);
      return new Response('', { status: 200 });
    }
    if (method === 'POST' && path === `/api/0/organizations/wishlist/releases/${SHA}/assemble/`) {
      const { checksum, chunks } = JSON.parse(init.body);
      const missing = chunks.filter((c) => !blobs.has(c));
      if (missing.length) return Response.json({ state: 'not_found', missingChunks: missing });
      const bundle = Buffer.concat(chunks.map((c) => blobs.get(c)));
      assert.equal(sha1(bundle), checksum);
      if (store) {
        const entries = readZip(bundle);
        const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
        assert.equal(manifest.org, 'wishlist');
        assert.equal(manifest.release, SHA);
        rows = Object.entries(manifest.files)
          .filter(([, f]) => f.type === 'minified_source')
          .map(([key, f], i) => ({
            id: String(i),
            name: f.url.split('/').pop(),
            sha1: sha1(entries.get(key)),
            headers: f.headers,
          }));
        if (tamper) rows = tamper(rows);
      }
      return Response.json({ state: 'created', missingChunks: [] });
    }
    if (method === 'GET' && path === `/api/0/organizations/wishlist/releases/${SHA}/files/`) {
      // Une ligne par page, pour exercer la pagination par en-tête Link.
      const index = Number(target.searchParams.get('cursor') ?? 0);
      const headers = {};
      if (index + 1 < rows.length) {
        headers.Link = `<${nextBase}${path}?cursor=${index + 1}>; rel="next"; results="true"; cursor="${index + 1}"`;
      }
      return Response.json(rows.slice(index, index + 1), { headers });
    }
    return new Response('', { status: 404 });
  }
  return { fetchImpl, calls };
}

let root;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'cartes-'));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function freshBuild(options) {
  const dir = await mkdtemp(join(root, 'build-'));
  await makeBuild(dir, options);
  return dir;
}

const quiet = () => {};

describe('collectArtifacts', () => {
  it('apparie chaque script à sa carte et ignore un script sans carte', async () => {
    const dir = await freshBuild();
    const artifacts = await collectArtifacts(dir);
    assert.deepEqual(
      artifacts.map((a) => [a.path, a.debugId]),
      [
        ['chunks/app/page-2.js', ID_B],
        ['chunks/main-1.js', ID_A],
      ],
    );
  });

  it('échoue si inject n’a pas été appliqué', async () => {
    const dir = await freshBuild({ injected: false });
    await assert.rejects(collectArtifacts(dir), /glitchtip-cli sourcemaps inject/);
  });

  it('échoue si la carte porte un autre identifiant que le script', async () => {
    const dir = await freshBuild();
    await writeFile(join(dir, 'chunks/main-1.js.map'), sourceMap(ID_B));
    await assert.rejects(collectArtifacts(dir), /même identifiant/);
  });

  it('échoue sans aucune carte (build fait sans BROWSER_SOURCEMAPS)', async () => {
    const dir = await mkdtemp(join(root, 'vide-'));
    await writeFile(join(dir, 'a.js'), 'void 0;\n');
    await assert.rejects(collectArtifacts(dir), /BROWSER_SOURCEMAPS/);
  });
});

describe('buildBundle', () => {
  it('produit un zip lisible avec le manifeste attendu par GlitchTip 7', async () => {
    const dir = await freshBuild();
    const artifacts = await collectArtifacts(dir);
    const entries = readZip(
      buildBundle({ org: 'wishlist', release: SHA, urlPrefix: '~/_next/static/', artifacts }),
    );
    const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
    assert.equal(manifest.org, 'wishlist');
    assert.equal(manifest.release, SHA);
    assert.deepEqual(manifest.files['files/chunks/main-1.js'], {
      url: '~/_next/static/chunks/main-1.js',
      type: 'minified_source',
      headers: { 'debug-id': ID_A, Sourcemap: 'main-1.js.map' },
    });
    assert.deepEqual(manifest.files['files/chunks/main-1.js.map'], {
      url: '~/_next/static/chunks/main-1.js.map',
      type: 'source_map',
      headers: { 'debug-id': ID_A },
    });
    assert.deepEqual(
      entries.get('files/chunks/main-1.js'),
      await readFile(join(dir, 'chunks/main-1.js')),
    );
    assert.ok(!entries.has('files/chunks/polyfills.js'));
  });

  it('est déterministe', async () => {
    const dir = await freshBuild();
    const artifacts = await collectArtifacts(dir);
    const args = { org: 'wishlist', release: SHA, urlPrefix: '~/_next/static', artifacts };
    assert.equal(sha1(buildBundle(args)), sha1(buildBundle(args)));
  });
});

describe('readConfig', () => {
  it('nomme les variables manquantes, jamais une valeur', () => {
    assert.throws(
      () => readConfig({ ...ENV, GLITCHTIP_ORG: '', RELEASE: undefined }),
      (error) => {
        assert.match(error.message, /GLITCHTIP_ORG, RELEASE/);
        return true;
      },
    );
  });

  it('refuse le jeton en clair hors de la machine (http seulement pour localhost)', () => {
    assert.throws(
      () => readConfig({ ...ENV, GLITCHTIP_URL: 'http://glitchtip.example.test' }),
      /https/,
    );
    assert.equal(
      readConfig({ ...ENV, GLITCHTIP_URL: 'http://localhost:8000' }).origin,
      'http://localhost:8000',
    );
  });

  it('refuse des identifiants, une chaîne de requête, un slug ou une release invalides', () => {
    assert.throws(
      () => readConfig({ ...ENV, GLITCHTIP_URL: 'https://a:b@glitchtip.example.test' }),
      /identifiants/,
    );
    assert.throws(() => readConfig({ ...ENV, GLITCHTIP_URL: `${BASE}/?x=1` }), /requête/);
    assert.throws(
      () => readConfig({ ...ENV, GLITCHTIP_ORG: '../admin' }),
      /GLITCHTIP_ORG invalide/,
    );
    assert.throws(() => readConfig({ ...ENV, RELEASE: 'v1.0.0' }), /RELEASE invalide/);
  });
});

describe('upload (OBS-31, OBS-34)', () => {
  it('envoie par morceaux, assemble et vérifie côté serveur, pages suivies', async () => {
    const dir = await freshBuild();
    const { fetchImpl, calls } = fakeGlitchTip({ chunkSize: 200 });
    const result = await upload({
      root: dir,
      urlPrefix: '~/_next/static',
      env: ENV,
      fetchImpl,
      log: quiet,
      pollIntervalMs: 1,
    });
    assert.equal(result.artifacts, 2);
    assert.ok(result.chunks > 1, 'plusieurs morceaux');
    assert.ok(calls.every((c) => c.origin === BASE));
    assert.ok(calls.filter((c) => c.path.includes('/files/')).length >= 2, 'deuxième page lue');
  });

  it('échoue si GlitchTip n’a rien stocké (assemblage rejeté en tâche de fond)', async () => {
    const dir = await freshBuild();
    const { fetchImpl } = fakeGlitchTip({ store: false });
    await assert.rejects(
      upload({
        root: dir,
        urlPrefix: '~',
        env: ENV,
        fetchImpl,
        log: quiet,
        pollIntervalMs: 1,
        pollTimeoutMs: 20,
      }),
      /2 script\(s\) sur 2 absents/,
    );
  });

  it('échoue si un fichier stocké n’a pas le contenu envoyé', async () => {
    const dir = await freshBuild();
    const tamper = (rows) => rows.map((r, i) => (i === 0 ? { ...r, sha1: '0'.repeat(40) } : r));
    const { fetchImpl } = fakeGlitchTip({ tamper });
    await assert.rejects(
      upload({
        root: dir,
        urlPrefix: '~',
        env: ENV,
        fetchImpl,
        log: quiet,
        pollIntervalMs: 1,
        pollTimeoutMs: 20,
      }),
      /1 script\(s\) sur 2 absents/,
    );
  });

  it('n’envoie jamais le jeton à un autre hôte que GLITCHTIP_URL (OBS-35)', async () => {
    const dir = await freshBuild();
    const { fetchImpl, calls } = fakeGlitchTip({
      chunkUrl: 'https://ailleurs.example.test/upload/',
    });
    await assert.rejects(
      upload({ root: dir, urlPrefix: '~', env: ENV, fetchImpl, log: quiet }),
      (error) => {
        assert.ok(error instanceof SourcemapError);
        assert.match(error.message, /autre hôte/);
        assert.ok(!error.message.includes(TOKEN));
        return true;
      },
    );
    assert.ok(calls.every((c) => c.origin === BASE));
  });

  for (const [label, nextBase] of [
    ['un autre hôte', 'https://ailleurs.example.test'],
    ['le même hôte en http', 'http://glitchtip.example.test'],
  ]) {
    it(`refuse un lien de page suivante vers ${label} (OBS-35)`, async () => {
      const dir = await freshBuild();
      const { fetchImpl, calls } = fakeGlitchTip({ nextBase });
      await assert.rejects(
        upload({ root: dir, urlPrefix: '~', env: ENV, fetchImpl, log: quiet, pollIntervalMs: 1 }),
        /autre hôte/,
      );
      assert.ok(calls.every((c) => c.origin === BASE));
    });
  }

  it('une réponse en erreur nomme l’étape et le code, sans le jeton', async () => {
    const dir = await freshBuild();
    const fetchImpl = async () => new Response(`erreur ${TOKEN}`, { status: 403 });
    await assert.rejects(
      upload({ root: dir, urlPrefix: '~', env: ENV, fetchImpl, log: quiet }),
      (error) => {
        assert.equal(error.message, 'Création de la release : réponse 403.');
        return true;
      },
    );
  });
});

describe('missingArtifacts', () => {
  it('exige le nom, l’identifiant de débogage et le contenu', () => {
    const script = Buffer.from('x');
    const expected = [{ path: 'chunks/a.js', debugId: ID_A, script }];
    const row = { name: 'a.js', sha1: sha1(script), headers: { 'debug-id': ID_A } };
    assert.deepEqual(missingArtifacts(expected, [row]), []);
    assert.equal(missingArtifacts(expected, [{ ...row, name: 'b.js' }]).length, 1);
    assert.equal(missingArtifacts(expected, [{ ...row, headers: { 'debug-id': ID_B } }]).length, 1);
    assert.equal(missingArtifacts(expected, []).length, 1);
  });
});

describe('strip et check (OBS-30)', () => {
  it('check trouve les cartes et les références, strip les retire toutes', async () => {
    const dir = await freshBuild();
    assert.deepEqual((await findLeftovers(dir)).sort(), [
      'chunks/app/page-2.js',
      'chunks/app/page-2.js.map',
      'chunks/main-1.js',
      'chunks/main-1.js.map',
      'css/app.css',
      'css/app.css.map',
    ]);
    assert.deepEqual(await strip(dir), { removed: 3, rewritten: 3 });
    assert.deepEqual(await findLeftovers(dir), []);
    // Le reste du script est intact, identifiant de débogage compris.
    assert.equal(
      await readFile(join(dir, 'chunks/main-1.js'), 'utf8'),
      `console.log("main-1.js");\n//# debugId=${ID_A}\n`,
    );
    assert.deepEqual((await readdir(join(dir, 'chunks'))).sort(), [
      'app',
      'main-1.js',
      'polyfills.js',
    ]);
  });

  it('check refuse une référence après du code et une carte intégrée en data:', async () => {
    const dir = await mkdtemp(join(root, 'refs-'));
    await writeFile(join(dir, 'a.js'), 'foo();//# sourceMappingURL=a.js.map\n');
    await writeFile(
      join(dir, 'b.js'),
      'bar();//# sourceMappingURL=data:application/json;base64,e30=\n',
    );
    await writeFile(join(dir, 'c.css'), 'a{}/*# sourceMappingURL=data:application/json,{} */\n');
    await writeFile(join(dir, 'd.js'), 'ok();\n');
    assert.deepEqual(await findLeftovers(dir), ['a.js', 'b.js', 'c.css']);
  });

  it('strip ne touche qu’à la fin du fichier ; check signale le reste', async () => {
    const dir = await mkdtemp(join(root, 'milieu-'));
    const inside = 'x=`\n//# sourceMappingURL=garder\n`;\nfoo();\n';
    await writeFile(join(dir, 'a.js'), `${inside}//# sourceMappingURL=a.js.map\n\n`);
    assert.deepEqual(await strip(dir), { removed: 0, rewritten: 1 });
    assert.equal(await readFile(join(dir, 'a.js'), 'utf8'), `${inside}\n`);
    assert.deepEqual(await findLeftovers(dir), ['a.js']);
  });

  it('check signale une entrée qui n’est ni fichier ni dossier', async (t) => {
    const dir = await mkdtemp(join(root, 'lien-'));
    await writeFile(join(root, 'cible.json'), '{}');
    try {
      await symlink(join(root, 'cible.json'), join(dir, 'x.js.map'));
    } catch (error) {
      // Windows sans le mode développeur refuse de créer un lien.
      if (error?.code === 'EPERM') return t.skip('liens symboliques interdits ici');
      throw error;
    }
    assert.deepEqual(await findLeftovers(dir), ['x.js.map']);
  });
});

describe('parseArgs', () => {
  it('check accepte plusieurs dossiers, upload et strip un seul', () => {
    assert.deepEqual(parseArgs(['check', 'a', 'b']).roots, ['a', 'b']);
    assert.equal(parseArgs(['upload', 'a', '--url-prefix', '~/x']).urlPrefix, '~/x');
    assert.throws(() => parseArgs(['upload', 'a', 'b']), /Usage/);
    assert.throws(() => parseArgs(['strip']), /Usage/);
    assert.throws(() => parseArgs(['check', 'a', '--url-prefix', '~']), /Argument inconnu/);
  });
});
