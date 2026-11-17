import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { sharedLink } from '@/features/share/share-screen';
import fr from '../../../messages/fr.json';
import { announceMoment, InstallInvite } from './engagement';

// PWA-02 : lien reçu par la cible de partage ; PWA-03 : invitation à installer après un premier
// souhait, jamais avant.

describe('Cible de partage (PWA-02)', () => {
  it('prend le lien de `url`, sinon le premier lien du texte ; ignore le reste', () => {
    expect(sharedLink({ url: 'https://boutique.example/velo' })).toBe(
      'https://boutique.example/velo',
    );
    expect(sharedLink({ text: 'Regarde ce vélo https://boutique.example/v?x=1 sympa' })).toBe(
      'https://boutique.example/v?x=1',
    );
    expect(sharedLink({ text: 'javascript:alert(1)' })).toBeNull();
    expect(sharedLink({})).toBeNull();
  });
});

describe('InstallInvite (PWA-03)', () => {
  it('rien à la première visite ; proposée après un premier souhait ajouté', () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Europe/Paris">
        <InstallInvite />
      </NextIntlClientProvider>,
    );
    const prompt = Object.assign(new Event('beforeinstallprompt'), {
      prompt: () => Promise.resolve(),
    });
    act(() => {
      window.dispatchEvent(prompt);
    });
    expect(screen.queryByRole('complementary', { name: fr.pwa.installTitle })).toBeNull();
    act(() => {
      announceMoment('wish-added');
    });
    expect(screen.getByRole('complementary', { name: fr.pwa.installTitle })).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.pwa.install })).toBeTruthy();
  });
});
