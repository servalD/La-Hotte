import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Fumée de phase 0 : la page s'affiche, est accessible et porte ses en-têtes de sécurité.

test('la page d’accueil s’affiche sans violation d’accessibilité sérieuse', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'La Hotte' })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
});

test('SEC-13 : CSP à nonce et en-têtes de sécurité', async ({ page }) => {
  const response = await page.goto('/');
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
});

test('validation côté client par le schéma Zod généré', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByText('Donnez un titre à ce souhait.')).toBeVisible();
  await expect(page.getByLabel('Titre du souhait')).toHaveAttribute('aria-invalid', 'true');
});
