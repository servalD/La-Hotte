// Règle d'architecture de apps/api (QA-02, QA-03, ADR 0002).
//
// Classement d'un fichier, à partir du dossier `src/` de l'application :
//   src/modules/<m>/<couche>/...   couche d'un module métier
//   src/modules/<m>/<fichier>      racine du module (index.ts, <m>.module.ts)
//   src/shared/<couche>/...        noyau partagé, mêmes couches
//   src/... (le reste)             plateforme technique (config, journalisation, Prisma, erreurs HTTP)
//
// Contrôles :
//   1. Sens des couches : presentation → application → domain ← infrastructure.
//   2. Un module n'importe d'un autre module que son index.ts.
//   3. domain n'importe aucun paquet (ni NestJS, ni Prisma, ni Node), sauf liste blanche explicite.
//   4. domain et application n'importent pas la plateforme technique.

import path from 'node:path';

export const LAYERS = /** @type {const} */ ([
  'domain',
  'application',
  'infrastructure',
  'presentation',
]);

/** Couches qu'une couche a le droit d'importer, dans le même module ou dans `shared`. */
export const ALLOWED_LAYERS = {
  domain: ['domain'],
  application: ['domain', 'application'],
  infrastructure: ['domain', 'application', 'infrastructure'],
  presentation: ['application', 'presentation'],
};

const toPosix = (p) => p.split(path.sep).join('/');

/**
 * @param {string} absPath chemin absolu (sans extension obligatoire)
 * @returns {null | {kind: 'module', module: string, layer: string}
 *   | {kind: 'module-root', module: string, file: string}
 *   | {kind: 'shared', layer: string | null}
 *   | {kind: 'platform'}}
 */
export function classify(absPath) {
  const p = toPosix(absPath);
  const idx = p.lastIndexOf('/src/');
  if (idx === -1) return null;
  const parts = p.slice(idx + '/src/'.length).split('/');

  if (parts[0] === 'modules' && parts[1]) {
    const module = parts[1];
    if (parts.length === 2) return { kind: 'module-root', module, file: 'index' };
    const second = parts[2];
    if (parts.length === 3) {
      return { kind: 'module-root', module, file: second.replace(/\.[cm]?[jt]sx?$/, '') };
    }
    if (LAYERS.includes(second)) return { kind: 'module', module, layer: second };
    return { kind: 'module', module, layer: 'unknown' };
  }
  if (parts[0] === 'shared') {
    const layer = parts.length > 2 && LAYERS.includes(parts[1]) ? parts[1] : null;
    return { kind: 'shared', layer };
  }
  return { kind: 'platform' };
}

const isRelative = (s) => s.startsWith('./') || s.startsWith('../') || s === '.' || s === '..';
const packageName = (s) =>
  s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0];

/** @type {import('eslint').Rule.RuleModule} */
export const architectureRule = {
  meta: {
    type: 'problem',
    docs: { description: 'Sens des dépendances entre couches et modules (QA-03)' },
    schema: [
      {
        type: 'object',
        properties: {
          domainAllowedPackages: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unknownLayer:
        'Dossier inconnu dans le module « {{module}} » : seules les couches domain, application, infrastructure et presentation sont permises.',
      layer:
        'La couche {{from}} ne peut pas importer la couche {{to}} (sens permis : presentation → application → domain ← infrastructure).',
      crossModule:
        "Le module « {{from}} » importe l'intérieur du module « {{to}} ». Passer par « modules/{{to}} » (son index.ts).",
      domainPackage:
        "La couche domain n'importe aucune bibliothèque (« {{pkg}} »). Déclarer un port et l'implémenter dans infrastructure.",
      platform:
        'La couche {{from}} ne peut pas importer la plateforme technique. Passer par un port du domaine.',
      sharedToModule: 'Le noyau partagé ne dépend d’aucun module métier.',
      ownIndex:
        "Une couche n'importe pas l'index de son propre module : importer directement le fichier visé.",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const domainAllowed = new Set(options.domainAllowedPackages ?? []);
    const filename = context.filename ?? context.getFilename();
    const from = classify(filename);
    if (!from) return {};

    function check(node, specifier) {
      if (typeof specifier !== 'string') return;

      // Paquet (ou module natif de Node).
      if (!isRelative(specifier)) {
        const fromLayer = from.kind === 'module' || from.kind === 'shared' ? from.layer : null;
        if (fromLayer === 'domain' && !domainAllowed.has(packageName(specifier))) {
          context.report({ node, messageId: 'domainPackage', data: { pkg: specifier } });
        }
        return;
      }

      const target = classify(path.resolve(path.dirname(filename), specifier));
      if (!target) return;

      // Fichier importateur : racine de module ou plateforme.
      if (from.kind === 'module-root' || from.kind === 'platform') {
        if (target.kind === 'module' && target.module !== (from.module ?? null)) {
          context.report({
            node,
            messageId: 'crossModule',
            data: { from: from.module ?? 'plateforme', to: target.module },
          });
        }
        if (
          target.kind === 'module-root' &&
          target.module !== (from.module ?? null) &&
          target.file !== 'index'
        ) {
          context.report({
            node,
            messageId: 'crossModule',
            data: { from: from.module ?? 'plateforme', to: target.module },
          });
        }
        return;
      }

      const fromLayer = from.layer;

      if (from.kind === 'module' && fromLayer === 'unknown') {
        context.report({ node, messageId: 'unknownLayer', data: { module: from.module } });
        return;
      }

      // Importateur : une couche d'un module, ou du noyau partagé.
      if (target.kind === 'platform') {
        if (fromLayer === 'domain' || fromLayer === 'application' || fromLayer === null) {
          context.report({ node, messageId: 'platform', data: { from: fromLayer ?? 'shared' } });
        }
        return;
      }

      if (target.kind === 'shared') {
        if (target.layer && fromLayer && !ALLOWED_LAYERS[fromLayer].includes(target.layer)) {
          context.report({ node, messageId: 'layer', data: { from: fromLayer, to: target.layer } });
        }
        return;
      }

      if (from.kind === 'shared') {
        context.report({ node, messageId: 'sharedToModule' });
        return;
      }

      // from.kind === 'module'
      if (target.module !== from.module) {
        if (!(target.kind === 'module-root' && target.file === 'index')) {
          context.report({
            node,
            messageId: 'crossModule',
            data: { from: from.module, to: target.module },
          });
        }
        return;
      }

      if (target.kind === 'module-root') {
        context.report({ node, messageId: 'ownIndex' });
        return;
      }

      if (target.layer === 'unknown' || !ALLOWED_LAYERS[fromLayer].includes(target.layer)) {
        context.report({ node, messageId: 'layer', data: { from: fromLayer, to: target.layer } });
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node.source, node.source.value),
      ExportAllDeclaration: (node) => check(node.source, node.source.value),
      ImportExpression: (node) =>
        node.source.type === 'Literal' && check(node.source, node.source.value),
    };
  },
};

export default {
  meta: { name: '@wishlist/eslint-plugin-architecture' },
  rules: { layers: architectureRule },
};
