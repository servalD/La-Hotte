// Garde de non-fuite du contrat (VIS-20, API-12), par LISTE BLANCHE.
//
// Une vue destinataire (`*RecipientView`) ne peut contenir que les champs listés ici, et ne peut
// atteindre que les schémas listés ici. Ajouter un champ à une vue destinataire exige donc de
// modifier cette liste, ce qui rend le changement visible en revue.
// Un motif de noms interdits reste en second filet pour les champs et les valeurs d'énumération.

export interface Schema {
  type?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  not?: Schema;
  additionalProperties?: boolean | Schema;
  enum?: unknown[];
  $ref?: string;
}

export interface RecipientViewRule {
  /** Champs autorisés à la racine de la vue. */
  fields: readonly string[];
  /** Schémas que la vue peut référencer, directement ou non (énumérations, objets imbriqués). */
  schemas: readonly string[];
}

export const RECIPIENT_VIEW_ALLOWLIST: Record<string, RecipientViewRule> = {
  ExampleItemRecipientView: {
    fields: ['view', 'id', 'title', 'priority'],
    schemas: ['ExampleItemRecipientViewView', 'ExamplePriority'],
  },
};

/** Second filet : vocabulaire d'offreur, quel que soit l'endroit où il apparaît. */
const GIVER_WORDS =
  /contribution|buyer|settlement|giver|reserv|purchase|book|claim|offer|taken|avail|state|status|particip|share|paid|amount|fund|progress|thread|comment|gift/i;
const GIVER_VOCABULARY = {
  test: (text: string): boolean => GIVER_WORDS.test(text) || /by[A-Z_]/.test(text),
};

const refName = (ref: string): string => ref.split('/').pop() ?? ref;

function children(schema: Schema): Schema[] {
  const out: Schema[] = [];
  out.push(...Object.values(schema.properties ?? {}));
  if (schema.items) out.push(schema.items);
  out.push(...(schema.allOf ?? []), ...(schema.oneOf ?? []), ...(schema.anyOf ?? []));
  if (schema.not) out.push(schema.not);
  if (typeof schema.additionalProperties === 'object') out.push(schema.additionalProperties);
  return out;
}

/**
 * Renvoie la liste des problèmes de non-fuite ; vide si tout est conforme.
 * Parcourt `properties`, `items`, `allOf`, `oneOf`, `anyOf`, `not`, `additionalProperties` et les
 * références, ainsi que les valeurs d'énumération.
 */
export function findRecipientViewLeaks(
  schemas: Record<string, Schema>,
  allowlist: Record<string, RecipientViewRule> = RECIPIENT_VIEW_ALLOWLIST,
): string[] {
  const problems: string[] = [];
  const views = Object.keys(schemas).filter((name) => name.endsWith('RecipientView'));

  for (const name of views) {
    const rule = allowlist[name];
    if (!rule) {
      problems.push(`${name} : vue destinataire absente de la liste blanche`);
      continue;
    }
    const root = schemas[name];
    if (!root) continue;

    const rootFields = Object.keys(root.properties ?? {});
    for (const field of rootFields) {
      if (!rule.fields.includes(field)) problems.push(`${name}.${field} : champ non autorisé`);
    }

    const visited = new Set<string>();
    const walk = (schema: Schema, path: string): void => {
      if (schema.$ref) {
        const target = refName(schema.$ref);
        if (!rule.schemas.includes(target) && target !== name) {
          problems.push(`${path} : référence non autorisée vers ${target}`);
          return;
        }
        if (visited.has(target)) return;
        visited.add(target);
        const resolved = schemas[target];
        if (resolved) walk(resolved, target);
        return;
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (GIVER_VOCABULARY.test(key)) problems.push(`${path}.${key} : vocabulaire d'offreur`);
        walk(child, `${path}.${key}`);
      }
      for (const value of schema.enum ?? []) {
        if (typeof value === 'string' && GIVER_VOCABULARY.test(value)) {
          problems.push(`${path} : valeur d'énumération « ${value} » (vocabulaire d'offreur)`);
        }
      }
      for (const child of children(schema)) {
        if (!Object.values(schema.properties ?? {}).includes(child)) walk(child, path);
      }
    };
    walk(root, name);
  }
  return problems;
}
