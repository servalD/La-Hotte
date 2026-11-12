import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// API-12 / critère d'acceptation de 13 : aucune vue destinataire ne contient de champ d'offreur.
// Vérifié sur le contrat versionné, pour toutes les vues présentes et futures.

interface Schema {
  properties?: Record<string, Schema>;
  items?: Schema;
  allOf?: Schema[];
  $ref?: string;
}

const doc = JSON.parse(readFileSync(resolve(__dirname, '../../openapi.json'), 'utf8')) as {
  components: { schemas: Record<string, Schema> };
};
const schemas = doc.components.schemas;

const GIVER_FIELDS = /contribution|buyer|settlement|giver|reserv|purchase/i;

function fieldNames(schema: Schema, seen = new Set<string>()): string[] {
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop() ?? '';
    if (seen.has(name)) return [];
    seen.add(name);
    const target = schemas[name];
    return target ? fieldNames(target, seen) : [];
  }
  const own = Object.entries(schema.properties ?? {}).flatMap(([key, child]) => [
    key,
    ...fieldNames(child, seen),
  ]);
  const nested = [...(schema.allOf ?? []), ...(schema.items ? [schema.items] : [])].flatMap((s) =>
    fieldNames(s, seen),
  );
  return [...own, ...nested];
}

const recipientViews = Object.keys(schemas).filter((name) => name.endsWith('RecipientView'));

describe('openapi.json — vues destinataire (VIS-20, API-12)', () => {
  it('au moins une vue destinataire est vérifiée', () => {
    expect(recipientViews.length).toBeGreaterThan(0);
  });

  it.each(recipientViews)('%s ne contient aucun champ d’offreur', (name) => {
    const fields = fieldNames(schemas[name]!);
    expect(fields.filter((f) => GIVER_FIELDS.test(f))).toEqual([]);
  });
});
