import { expect, test } from '@playwright/test';

// Fumée du socle : la CSP à nonce et les en-têtes de sécurité (SEC-13) tiennent sur un écran public.

test('SEC-13 : CSP à nonce et en-têtes de sécurité', async ({ page }) => {
  const response = await page.goto('/auth/login');
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
});
