import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findRecipientViewLeaks, type Schema } from './recipient-view-guard';

// VIS-20, API-12, critère d'acceptation de 13 : aucune vue destinataire ne contient de champ
// d'offreur. Liste blanche par vue (voir recipient-view-guard.ts), vérifiée sur openapi.json.

const doc = JSON.parse(readFileSync(resolve(__dirname, '../../openapi.json'), 'utf8')) as {
  components: { schemas: Record<string, Schema> };
};
const schemas = doc.components.schemas;

describe('openapi.json — vues destinataire (VIS-20, API-12)', () => {
  it('au moins une vue destinataire est vérifiée', () => {
    expect(Object.keys(schemas).filter((n) => n.endsWith('RecipientView')).length).toBeGreaterThan(
      0,
    );
  });

  it('le contrat versionné respecte la liste blanche', () => {
    expect(findRecipientViewLeaks(schemas)).toEqual([]);
  });
});

// Le garde doit échouer quand la protection est retirée (QA-10, revue de sécurité de la phase 0) :
// chaque mutation ci-dessous est une fuite réaliste, elle doit être détectée.
describe('garde de non-fuite — il détecte les fuites (VIS-20)', () => {
  const mutate = (fn: (copy: Record<string, Schema>) => void): string[] => {
    const copy = structuredClone(schemas);
    fn(copy);
    return findRecipientViewLeaks(copy);
  };
  const view = (copy: Record<string, Schema>): Schema => copy.ExampleItemRecipientView!;

  it.each([
    [
      'un champ « isAvailable »',
      (c: Record<string, Schema>) => (view(c).properties!.isAvailable = { type: 'boolean' }),
    ],
    [
      'un champ neutre en apparence « meta »',
      (c: Record<string, Schema>) => (view(c).properties!.meta = { type: 'object' }),
    ],
    [
      'un champ « status » énuméré',
      (c: Record<string, Schema>) =>
        (view(c).properties!.status = { type: 'string', enum: ['available', 'reserved'] }),
    ],
    [
      'un champ « claimedBy »',
      (c: Record<string, Schema>) => (view(c).properties!.claimedBy = { type: 'string' }),
    ],
    [
      'un champ « booking » vers la réservation',
      (c: Record<string, Schema>) =>
        (view(c).properties!.booking = { $ref: '#/components/schemas/ExampleReservationView' }),
    ],
    [
      'un champ « participants »',
      (c: Record<string, Schema>) =>
        (view(c).properties!.participants = { type: 'array', items: { type: 'string' } }),
    ],
    [
      'un champ « fundedPercent »',
      (c: Record<string, Schema>) => (view(c).properties!.fundedPercent = { type: 'number' }),
    ],
    [
      'un oneOf vers la vue offreur',
      (c: Record<string, Schema>) =>
        (view(c).oneOf = [{ $ref: '#/components/schemas/ExampleItemGiverView' }]),
    ],
    [
      'un allOf vers la vue offreur',
      (c: Record<string, Schema>) =>
        (view(c).allOf = [{ $ref: '#/components/schemas/ExampleItemGiverView' }]),
    ],
    [
      'un additionalProperties vers la vue offreur',
      (c: Record<string, Schema>) =>
        (view(c).additionalProperties = { $ref: '#/components/schemas/ExampleItemGiverView' }),
    ],
    [
      'une valeur d’énumération « reserved » dans la priorité',
      (c: Record<string, Schema>) => (c.ExamplePriority!.enum = ['low', 'normal', 'reserved']),
    ],
    [
      'une nouvelle vue destinataire non déclarée',
      (c: Record<string, Schema>) =>
        (c.SearchResultRecipientView = { type: 'object', properties: { id: { type: 'string' } } }),
    ],
  ])('%s', (_label, change) => {
    expect(mutate(change)).not.toEqual([]);
  });
});
