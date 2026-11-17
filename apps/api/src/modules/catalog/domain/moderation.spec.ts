import { describe, expect, it } from 'vitest';
import { contentFlagged, statusOnPublish } from './moderation';

const lists = { forbiddenTerms: ['contrefacon', 'arme a feu'], blockedDomains: ['louche.example'] };
const base = {
  title: 'Robot pâtissier',
  description: 'Bol inox',
  merchant: 'Boutique',
  sourceUrl: 'https://boutique.example/robot',
  source: 'LINK' as const,
  extractionStatus: 'DONE' as const,
};

describe('Contrôle automatique et statut à la publication (MOD-06, MOD-09)', () => {
  it('lien extrait et propre : visible tout de suite', () => {
    expect(statusOnPublish(base, lists)).toBe('APPROVED');
  });

  it('saisie à la main, photo ou extraction ratée : en file', () => {
    expect(statusOnPublish({ ...base, source: 'MANUAL' }, lists)).toBe('PENDING');
    expect(statusOnPublish({ ...base, source: 'PHOTO' }, lists)).toBe('PENDING');
    expect(statusOnPublish({ ...base, extractionStatus: 'FAILED' }, lists)).toBe('PENDING');
  });

  it('terme interdit sans accent ni casse, en mot entier', () => {
    expect(contentFlagged({ ...base, title: 'Sac CONTREFAÇON' }, lists)).toBe(true);
    expect(contentFlagged({ ...base, description: 'Une Arme à feu factice' }, lists)).toBe(true);
    expect(contentFlagged({ ...base, title: 'Charme du feu' }, lists)).toBe(false);
    expect(statusOnPublish({ ...base, merchant: 'contrefaçon & co' }, lists)).toBe('PENDING');
  });

  it('domaine bloqué et ses sous-domaines', () => {
    expect(contentFlagged({ ...base, sourceUrl: 'https://louche.example/x' }, lists)).toBe(true);
    expect(contentFlagged({ ...base, sourceUrl: 'https://www.louche.example/x' }, lists)).toBe(
      true,
    );
    expect(contentFlagged({ ...base, sourceUrl: 'https://pas-louche.example/x' }, lists)).toBe(
      false,
    );
  });
});
