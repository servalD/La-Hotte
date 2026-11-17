import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';

// Critères d'acceptation de `08` (OFF-01 à OFF-30) : en mode avion, l'application s'ouvre, la
// liste s'affiche, je coche un achat et j'ajoute un commentaire ; au retour du réseau, les deux
// sont enregistrés une seule fois. Après déconnexion, aucune donnée ne reste sur l'appareil.
// API simulée au niveau du contexte (le service worker laisse passer `/api`).

const PROFILE = '0190f3c2-0000-7000-8000-000000000010';
const LEA = '0190f3c2-0000-7000-8000-000000000012';
const LIST = '0190f3c2-0000-7000-8000-0000000000a1';
const ITEM = '0190f3c2-0000-7000-8000-0000000000b1';
const PRODUCT = '0190f3c2-0000-7000-8000-0000000000c1';

const person = (id: string, displayName: string) => ({
  id,
  displayName,
  avatar: null,
  accentColor: '#2f6f4f',
});

const permissions = {
  edit: false,
  archive: false,
  delete: false,
  restore: false,
  manageMembers: false,
  add: 'none',
  editRules: false,
  readLog: false,
};

function table(): Record<string, unknown> {
  return {
    '/api/v1/session': {
      authenticated: true,
      csrfToken: 'csrf',
      secondFactorPending: false,
      session: {
        id: '0190f3c2-0000-7000-8000-000000000001',
        activeProfileId: PROFILE,
        profileUnlocked: true,
        expiresAt: '2030-01-01T00:00:00Z',
        sharedDevice: false,
        accountTag: 'a'.repeat(32),
      },
    },
    '/api/v1/profiles/me': {
      id: PROFILE,
      displayName: 'Camille',
      avatar: null,
      accentColor: '#2f6f4f',
      birthday: null,
      locale: 'fr',
      currency: 'EUR',
      timezone: 'Europe/Paris',
      isChild: false,
      hasPin: false,
      pinRelock: 'NEVER',
      pinResetNoticeAt: null,
      childNoticeAt: null,
      email: null,
      version: 1,
    },
    '/api/v1/profiles/me/cache-key': { encrypted: false, keyId: null, key: null },
    '/api/v1/notifications/unread-count': { count: 0 },
    [`/api/v1/lists/${LIST}`]: {
      view: 'giver',
      id: LIST,
      type: 'WISHLIST',
      title: 'Noël de Léa',
      description: '',
      personal: false,
      eventId: null,
      recipients: [LEA],
      myRole: null,
      audience: 'CIRCLE',
      customAudience: [],
      defaultItemVisibility: 'ALL',
      visibilityEditRole: 'OWNER',
      giftExistence: 'REVEALED',
      giftContent: 'FULL',
      archivedAt: null,
      deletedAt: null,
      createdAt: '2026-11-01T10:00:00Z',
      version: 1,
      permissions,
    },
    [`/api/v1/lists/${LIST}/items`]: {
      items: [
        {
          view: 'giver',
          id: ITEM,
          listId: LIST,
          product: {
            id: PRODUCT,
            title: 'Vélo rouge',
            description: '',
            imageKey: null,
            merchant: null,
            sourceUrl: null,
          },
          quantity: 1,
          unitPriceMinor: 12_000,
          currency: 'EUR',
          priority: 'WANT',
          note: '',
          manyWelcome: false,
          position: 1,
          hidden: false,
          visibilityMode: 'ALL',
          status: 'RESERVED',
          isSuggestion: false,
          shownToRecipient: false,
          intendedRecipientId: null,
          addedBy: LEA,
          mine: false,
          createdAt: '2026-11-01T10:00:00Z',
          carriedForward: false,
          carriedFrom: null,
          version: 3,
        },
      ],
    },
    [`/api/v1/items/${ITEM}/accounting`]: {
      view: 'participant',
      accountingId: '0190f3c2-0000-7000-8000-0000000000d1',
      itemId: ITEM,
      title: 'Vélo rouge',
      currency: 'EUR',
      plannedTotalMinor: 12_000,
      itemTotalMinor: null,
      coveredMinor: 12_000,
      remainingMinor: 0,
      buyer: person(PROFILE, 'Camille'),
      purchased: false,
      canContribute: false,
      participants: [
        {
          person: person(PROFILE, 'Camille'),
          mode: 'FULL',
          rank: 1,
          isBuyer: true,
          amountMinor: 12_000,
          units: null,
          mine: true,
        },
      ],
      mine: {
        id: '0190f3c2-0000-7000-8000-0000000000e1',
        mode: 'FULL',
        share: null,
        units: null,
        amountMinor: 12_000,
        rank: 1,
        settlement: 'NONE',
        settledMinor: 0,
      },
      isBuyer: true,
      reviewEnabled: true,
      receiptEnabled: false,
      reviews: [],
      buyerRequest: null,
      hasReceipt: false,
    },
    [`/api/v1/items/${ITEM}/threads`]: {
      view: 'giver',
      public: { count: 0, canWrite: true },
      givers: { count: 0, canWrite: true },
      following: false,
    },
    [`/api/v1/items/${ITEM}/comments`]: { items: [], nextCursor: null },
  };
}

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly key: string | null;
}

/** API simulée ; `network.online = false` coupe toute réponse (comme un mode avion). */
async function mockApi(context: BrowserContext) {
  const network = { online: true };
  const mutations: Recorded[] = [];
  const answered = new Map<string, unknown>();
  const data = table();
  await context.route('**/api/v1/**', async (route) => {
    if (!network.online) {
      await route.abort('internetdisconnected');
      return;
    }
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      const key = request.headers()['idempotency-key'] ?? null;
      // Idempotence de l'API (API-16) : même clé, même réponse, aucun nouvel effet.
      if (key && answered.has(key)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(answered.get(key)),
        });
        return;
      }
      mutations.push({ method: request.method(), path: url.pathname, key });
      const body = url.pathname.endsWith('/comments')
        ? {
            id: '0190f3c2-0000-7000-8000-0000000000f1',
            itemId: ITEM,
            thread: 'GIVERS',
            body: 'Je passe au magasin',
          }
        : data[`/api/v1/items/${ITEM}/accounting`];
      if (key) answered.set(key, body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      return;
    }
    const body = data[url.pathname];
    await route.fulfill({
      status: body === undefined ? 404 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        body ?? { type: 'about:blank', title: 'Not found', status: 404, code: 'NOT_FOUND' },
      ),
    });
  });
  return { network, mutations };
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
}

async function openAndClose(page: Page, button: string) {
  await page.getByRole('button', { name: button }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('mode avion : la liste s’affiche, achat et commentaire partent une seule fois au retour', async ({
  page,
  context,
}) => {
  const api = await mockApi(context);
  await page.goto(`/lists/${LIST}`);
  await expect(page.getByText('Vélo rouge')).toBeVisible();
  // Lectures faites en ligne : compta et discussion de l'élément (gardées dans le coffre).
  await openAndClose(page, 'Offrir');
  await openAndClose(page, 'Discussion');
  await page.waitForTimeout(1_500);

  await context.setOffline(true);
  api.network.online = false;
  await expect(page.getByText(/Hors ligne/)).toBeVisible();

  // Cocher l'achat en magasin, sans réseau (OFF-10).
  await page.getByRole('button', { name: 'Offrir' }).first().click();
  await page.getByRole('button', { name: 'Acheté', exact: true }).click();
  await expect(page.getByText('Acheté, à confirmer.')).toBeVisible();
  await page.keyboard.press('Escape');

  // Commenter hors ligne : « en attente d'envoi ».
  await page.getByRole('button', { name: 'Discussion' }).first().click();
  await page.getByLabel('Votre message').first().fill('Je passe au magasin');
  await page.getByRole('button', { name: 'Envoyer' }).first().click();
  await expect(page.getByText('En attente d’envoi'.replace('’', "'")).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expectAccessible(page);
  expect(api.mutations).toEqual([]);

  // Retour du réseau : rejeu dans l'ordre, une seule fois chacune (OFF-12, API-16).
  await context.setOffline(false);
  api.network.online = true;
  await expect.poll(() => api.mutations.length, { timeout: 15_000 }).toBe(2);
  expect(api.mutations.map((m) => `${m.method} ${m.path}`)).toEqual([
    `PUT /api/v1/items/${ITEM}/purchase`,
    `POST /api/v1/items/${ITEM}/comments`,
  ]);
  expect(api.mutations.every((m) => m.key !== null)).toBe(true);
  await page.waitForTimeout(1_000);
  expect(api.mutations).toHaveLength(2);
});

test('déconnexion : plus aucune base de données de l’application sur l’appareil (OFF-22)', async ({
  page,
  context,
}) => {
  await mockApi(context);
  await page.goto(`/lists/${LIST}`);
  await expect(page.getByText('Vélo rouge')).toBeVisible();
  await page.waitForTimeout(1_500);
  const before = await page.evaluate(async () =>
    (await indexedDB.databases()).map((d) => d.name ?? ''),
  );
  expect(before.some((name) => name.startsWith('lh-p-'))).toBe(true);
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/auth\/login/);
  const after = await page.evaluate(async () =>
    (await indexedDB.databases()).map((d) => d.name ?? ''),
  );
  expect(after.filter((name) => name.startsWith('lh-'))).toEqual([]);
});

test('/offline et /actions : sans violation d’accessibilité sérieuse', async ({
  page,
  context,
}) => {
  await mockApi(context);
  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: 'Vous êtes hors ligne' })).toBeVisible();
  await expectAccessible(page);
  await page.goto('/actions');
  await expect(page.getByRole('heading', { name: 'Actions en attente' })).toBeVisible();
  await expectAccessible(page);
});
