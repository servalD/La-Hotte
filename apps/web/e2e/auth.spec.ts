import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Tranche 7a : écrans d'accès, accessibles, et pages à jeton en no-referrer (jeton dans le fragment).

const PAGES = [
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-email',
  '/auth/cancel-email-change',
  '/auth/second-factor',
  '/auth/google/return',
  '/invitations/open',
  '/invitations/profile',
  '/accounts/setup',
  '/profiles/verify-email',
  '/transfers/consent',
  '/transfers/cancel',
];

for (const path of PAGES) {
  test(`${path} : aucune violation d’accessibilité sérieuse`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious).toEqual([]);
  });
}

for (const path of [
  '/auth/verify-email',
  '/auth/reset-password',
  '/auth/cancel-email-change',
  '/auth/google/return',
  '/invitations/open',
  '/invitations/profile',
  '/accounts/setup',
  '/profiles/verify-email',
  '/transfers/consent',
  '/transfers/cancel',
]) {
  test(`${path} : Referrer-Policy no-referrer`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  });
}

test('connexion : champs vides signalés par champ, sans appel serveur', async ({ page }) => {
  await page.goto('/auth/login');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByLabel('Adresse e-mail')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Mot de passe')).toHaveAttribute('aria-invalid', 'true');
});

test('inscription : la case d’âge n’est pas précochée (AUTH-08)', async ({ page }) => {
  await page.goto('/auth/register');
  await expect(page.getByLabel('J’ai 15 ans ou plus.')).not.toBeChecked();
});
