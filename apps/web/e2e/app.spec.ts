import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

// Écrans connectés, sans API : les réponses sont simulées au niveau du navigateur. Les tests
// vérifient l'accessibilité (WCAG 2.1 AA) et quelques parcours clés ; la logique d'accès reste
// celle de l'API, jamais celle du client.

const PROFILE_ID = '0190f3c2-0000-7000-8000-000000000010';
const OTHER_ID = '0190f3c2-0000-7000-8000-000000000011';

const session = (over: Record<string, unknown> = {}) => ({
  authenticated: true,
  csrfToken: 'csrf',
  secondFactorPending: false,
  session: {
    id: '0190f3c2-0000-7000-8000-000000000001',
    activeProfileId: PROFILE_ID,
    profileUnlocked: true,
    expiresAt: '2030-01-01T00:00:00Z',
    ...over,
  },
});

const profile = {
  id: PROFILE_ID,
  displayName: 'Camille',
  avatar: null,
  accentColor: '#2f6f4f',
  birthday: { day: 4, month: 12, year: null },
  locale: 'fr',
  currency: 'EUR',
  timezone: 'Europe/Paris',
  isChild: false,
  hasPin: true,
  pinRelock: 'NEVER',
  pinResetNoticeAt: null,
  childNoticeAt: null,
  email: null,
  version: 1,
};

const accountProfiles = {
  items: [
    {
      id: PROFILE_ID,
      displayName: 'Camille',
      avatar: null,
      accentColor: '#2f6f4f',
      hasPin: true,
      isChild: false,
      hasEmail: false,
    },
    {
      id: OTHER_ID,
      displayName: 'Noé',
      avatar: null,
      accentColor: '#b5472b',
      hasPin: false,
      isChild: true,
      hasEmail: false,
    },
  ],
};

const device = (extra: Record<string, unknown>) => ({
  id: '0190f3c2-0000-7000-8000-000000000020',
  userAgent: 'Firefox sur Linux',
  createdAt: '2026-11-01T10:00:00Z',
  ...extra,
});

function routes(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '/api/v1/session': session(),
    '/api/v1/profiles/me': profile,
    '/api/v1/profiles/me/transfer': { transfer: null },
    '/api/v1/links': { items: [] },
    '/api/v1/circle': { items: [] },
    '/api/v1/blocks': { items: [] },
    '/api/v1/invitations': { items: [] },
    '/api/v1/account': {
      email: 'camille@example.org',
      emailVerified: true,
      hasPassword: true,
      googleLinked: false,
      totpEnabled: false,
      recoveryCodesRemaining: 0,
    },
    '/api/v1/account/profiles': accountProfiles,
    '/api/v1/account/profile-proposals': { items: [] },
    '/api/v1/account/transfers': { items: [] },
    '/api/v1/account/wards': { items: [] },
    '/api/v1/sessions': {
      items: [device({ lastSeenAt: '2026-11-14T09:00:00Z', current: true })],
    },
    '/api/v1/trusted-devices': {
      items: [device({ expiresAt: '2026-12-01T00:00:00Z', current: false })],
    },
    ...over,
  };
}

async function mockApi(page: Page, table: Record<string, unknown>) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const body = table[url.pathname];
    if (body === undefined) {
      // Aucune donnée prévue (par exemple une demande de passage absente) : 404 neutre.
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Not found',
          status: 404,
          code: 'NOT_FOUND',
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious).toEqual([]);
}

const PROFILE_SCREENS = [
  ['/', 'Bonjour Camille'],
  ['/settings', 'Réglages du profil'],
  ['/circle', 'Cercle'],
  ['/invitations', 'Invitations'],
] as const;

const ACCOUNT_SCREENS = [
  ['/profiles', 'Qui regarde ?'],
  ['/account', 'Compte'],
  ['/account/security', 'Sécurité'],
  ['/account/profiles', 'Profils du compte'],
  ['/account/wards', 'Comptes sous tutelle'],
] as const;

for (const [path, heading] of [...PROFILE_SCREENS, ...ACCOUNT_SCREENS]) {
  test(`${path} : affiché et sans violation d’accessibilité sérieuse`, async ({ page }) => {
    await mockApi(page, routes());
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: false }).first()).toBeVisible();
    await expectAccessible(page);
  });
}

test('profil verrouillé : l’écran de PIN remplace le contenu (PIN-02)', async ({ page }) => {
  await mockApi(page, routes({ '/api/v1/session': session({ profileUnlocked: false }) }));
  await page.goto('/');
  await expect(page).toHaveURL(/\/profiles\/unlock$/);
  await expect(page.getByLabel('PIN', { exact: true })).toBeVisible();
  await expectAccessible(page);
});

test('sans session : retour à la connexion', async ({ page }) => {
  await mockApi(
    page,
    routes({
      '/api/v1/session': {
        authenticated: false,
        csrfToken: 'csrf',
        secondFactorPending: false,
        session: null,
      },
    }),
  );
  await page.goto('/circle');
  await expect(page).toHaveURL(/\/auth\/login$/);
});

test('activation du TOTP : le QR code et la clé s’affichent, jamais envoyés ailleurs', async ({
  page,
}) => {
  await mockApi(page, routes());
  await page.route('**/api/v1/auth/totp/enroll', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/La%20Hotte:camille?secret=JBSWY3DPEHPK3PXP&issuer=La%20Hotte',
      }),
    }),
  );
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') external.push(request.url());
  });
  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Activer le second facteur' }).click();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await expect(page.getByText('JBSWY3DPEHPK3PXP')).toBeVisible();
  await expectAccessible(page);
  expect(external).toEqual([]);
});
