import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  findRecipientViewLeaks,
  type RecipientViewRule,
  type Schema,
} from './recipient-view-guard';

// VIS-20, API-12, critère d'acceptation de 13 : aucune vue destinataire ne contient de champ
// d'offreur. Liste blanche par vue (voir recipient-view-guard.ts), vérifiée sur openapi.json.

const doc = JSON.parse(readFileSync(resolve(__dirname, '../../openapi.json'), 'utf8')) as {
  components: { schemas: Record<string, Schema> };
};
const schemas = doc.components.schemas;

// Contrat d'essai : le module de la phase 0 qui portait la seule vue destinataire est retiré, le
// garde reste testé sur ce contrat fictif de même forme (liste blanche, vue offreur, énumération).
const FIXTURE_ALLOWLIST: Record<string, RecipientViewRule> = {
  ExampleItemRecipientView: {
    fields: ['view', 'id', 'title', 'priority'],
    schemas: ['ExampleItemRecipientViewView', 'ExamplePriority'],
  },
};
const FIXTURE: Record<string, Schema> = {
  ExampleItemRecipientView: {
    type: 'object',
    properties: {
      view: { $ref: '#/components/schemas/ExampleItemRecipientViewView' },
      id: { type: 'string' },
      title: { type: 'string' },
      priority: { $ref: '#/components/schemas/ExamplePriority' },
    },
  },
  ExampleItemRecipientViewView: { type: 'string', enum: ['recipient'] },
  ExamplePriority: { type: 'string', enum: ['low', 'normal', 'high'] },
  ExampleItemGiverView: { type: 'object', properties: { id: { type: 'string' } } },
  ExampleReservationView: { type: 'object', properties: { id: { type: 'string' } } },
};

describe('openapi.json — vues destinataire (VIS-20, API-12)', () => {
  it('le contrat versionné respecte la liste blanche (aucune vue non déclarée)', () => {
    expect(findRecipientViewLeaks(schemas)).toEqual([]);
  });
});

// Le garde doit échouer quand la protection est retirée (QA-10, revue de sécurité de la phase 0) :
// chaque mutation ci-dessous est une fuite réaliste, elle doit être détectée.
describe('garde de non-fuite — il détecte les fuites (VIS-20)', () => {
  it('le contrat d’essai non muté est conforme', () => {
    expect(findRecipientViewLeaks(FIXTURE, FIXTURE_ALLOWLIST)).toEqual([]);
  });

  const mutate = (fn: (copy: Record<string, Schema>) => void): string[] => {
    const copy = structuredClone(FIXTURE);
    fn(copy);
    return findRecipientViewLeaks(copy, FIXTURE_ALLOWLIST);
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
