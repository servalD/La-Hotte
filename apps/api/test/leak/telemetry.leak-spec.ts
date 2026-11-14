// Premier import : télémétrie démarrée avant l'application, comme `instrument.ts` (OBS-12).
import { leakTelemetryEnv } from './start-telemetry';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import request from 'supertest';
import { generate } from 'otplib';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { LogDestination } from '../../src/platform/logging/logging.module';
import { RedisService } from '../../src/platform/redis/redis.service';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { shutdownTelemetry } from '../../src/platform/telemetry/telemetry';
import {
  BackgroundTasks,
  InMemoryBackgroundTasks,
  InMemoryBreachChecker,
  InMemoryMailSender,
  MailSender,
  PasswordBreachChecker,
} from '../../src/modules/identity/testing';
import { type FakeOidcProvider, startFakeOidcProvider } from '../support/fake-oidc-provider';
import { SessionLifecycle } from '../../src/modules/identity/application/session-lifecycle';
import { PRESESSION_COOKIE } from '../../src/modules/identity/presentation/cookies';
import { createAccountWithProfile, session as sessionHeaders, signIn } from '../support/sign-in';
import { CAPTURE_PROBE, captureOutput, type OutputCapture } from './capture-output';
import { describeHandedError } from './describe-handed-error.mjs';
import { LeakRoutesController } from './leak-routes.controller';
import { ALLOWED_EVENT_KEYS, AMOUNT_MARKER, envelopeEvents, findMarker, MARKER } from './markers';
import { type Channel, fetchRecords, type ReceivedRecord, resetRecords } from './receivers';

/**
 * OBS-26, volet A : des marqueurs entrent par toutes les portes d'une requête (corps, chemin,
 * chaîne de requête, en-têtes, erreurs, paramètres SQL) ; on vérifie qu'ils ne sortent par
 * aucun canal d'observation, tel que les exporteurs l'envoient réellement. Chaque canal doit
 * aussi être non vide : une instrumentation qui ne s'applique pas ne donne pas un faux vert.
 */

const receiverUrl = inject('receiverUrl');
const logLines: string[] = [];
const handedToSdk: string[] = [];
let records: ReceivedRecord[] = [];
let output: OutputCapture = { text: () => '', restore: () => undefined };
/**
 * Secrets de session (ADR 0013, « Télémétrie ») : jeton, hash, jeton CSRF de session et de
 * pré-session, identifiant de pré-session. Aucun ne doit sortir par un canal d'observation.
 */
const sessionSecrets: Record<string, string> = {};
/**
 * Secrets d'authentification (ADR 0013, « Télémétrie » ; SEC-31) : e-mail normalisé (en
 * minuscules, donc hors d'atteinte du marqueur), mots de passe, jetons envoyés par e-mail, jeton
 * de session ouvert par la connexion.
 */
const authSecrets: Record<string, string> = {};
/**
 * Secrets du second facteur (AUTH-10 à AUTH-12, SEC-22) : secret TOTP, codes de secours (forme
 * affichée et forme normalisée), jetons de pré-authentification et d'appareil de confiance. Les
 * codes TOTP (6 chiffres) ne se cherchent pas : un horodatage peut les contenir par hasard.
 */
const secondFactorSecrets: Record<string, string> = {};
/**
 * Secrets du parcours Google (AUTH-03, ADR 0013 « Retour OIDC ») : `state`, `nonce`, défi et
 * vérificateur PKCE, code d'autorisation, secret du client, identifiant et adresse Google, nom
 * saisi à l'inscription, session ouverte par le retour.
 */
const googleSecrets: Record<string, string> = {};
/**
 * Secrets des profils (PIN-01 à PIN-07) : PIN de 8 chiffres tirés au hasard (juste, faux, de
 * réinitialisation), cherchés isolés comme un montant (un horodatage peut contenir 8 chiffres),
 * hash argon2 du PIN, nonce de déverrouillage (`__Host-lh_unlock`), jeton de la session
 * ré-authentifiée.
 */
const pinSecrets: Record<string, string> = {};
const randomPin = (): string => String(randomInt(10_000_000, 99_999_999));
/**
 * Secrets des liens (LNK-01 à LNK-09) : jetons d'invitation et leur hash, adresse invitée (en
 * minuscules, donc hors d'atteinte du marqueur). Les noms de profils porteurs du marqueur sont
 * cherchés par `findMarker`.
 */
const linkSecrets: Record<string, string> = {};
/** Secrets de la tutelle (PRO-15, PRO-16) : adresse et nom du profil, lien d'installation, mot de passe. */
const wardSecrets: Record<string, string> = {};
/** Fournisseur OpenID Connect local, à la place de Google. */
let provider: FakeOidcProvider | undefined;
/** E-mails et tâches de fond observables ; aucun appel au service des fuites (réseau). */
const mail = new InMemoryMailSender();
const background = new InMemoryBackgroundTasks();

const capturingDestination: LogDestination = {
  write: (line: string) => {
    logLines.push(line);
  },
};

const CLIENT_TRACE_ID = randomBytes(16).toString('hex');

/** En-têtes porteurs de marqueur sur chaque requête. */
const markedHeaders = {
  Authorization: `Bearer ${MARKER}`,
  Cookie: `session=${MARKER}`,
  'Idempotency-Key': MARKER,
  'User-Agent': `navigateur ${MARKER}`,
  'X-Request-Id': MARKER,
  // Contexte de trace venu du client : `tracestate` et `baggage` sont du texte libre ; les clés
  // `sentry-*` du `baggage` et `sentry-trace` iraient dans l'enveloppe si le propagateur de
  // Sentry était un jour actif.
  traceparent: `00-${CLIENT_TRACE_ID}-${randomBytes(8).toString('hex')}-01`,
  tracestate: `client=${MARKER}`,
  baggage: `panier=${MARKER},sentry-transaction=${MARKER},sentry-release=${MARKER},sentry-environment=${MARKER}`,
  'sentry-trace': `${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-1`,
};

function bodies(channel: Channel): string {
  return records
    .filter((record) => record.channel === channel)
    .map((record) => record.body)
    .join('\n');
}

type SentEvent = Record<string, unknown> & {
  exception?: { values?: Array<{ type?: string }> };
  contexts?: { trace?: { trace_id?: string } };
};

function errorEvents(): SentEvent[] {
  return records
    .filter((record) => record.channel === 'errors')
    .flatMap((record) => envelopeEvents(record.body) as SentEvent[]);
}

beforeAll(async () => {
  // Récepteurs partagés entre fichiers : on ne garde que ce que ce fichier produit.
  await resetRecords(receiverUrl);

  // Objet exact transmis à `captureException` : `trustedStack` et `beforeSend` rattrapent
  // derrière, l'export seul ne verrait pas `sanitizeError` disparaître.
  const client = Sentry.getClient();
  if (!client) throw new Error('Sentry non démarré');
  client.on('beforeSendEvent', (_event, hint) => {
    handedToSdk.push(describeHandedError(hint?.originalException));
  });

  // Depuis la compilation du module : les journaux de Nest émis avant `useLogger` comptent aussi.
  output = captureOutput();

  let app: INestApplication | undefined;
  try {
    provider = await startFakeOidcProvider();
    Object.assign(process.env, {
      GOOGLE_CLIENT_ID: provider.clientId,
      GOOGLE_CLIENT_SECRET: provider.clientSecret,
      GOOGLE_OIDC_ISSUER: provider.issuer,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [LeakRoutesController],
    })
      .overrideProvider(LogDestination)
      .useValue(capturingDestination)
      .overrideProvider(MailSender)
      .useValue(mail)
      .overrideProvider(BackgroundTasks)
      .useValue(background)
      .overrideProvider(PasswordBreachChecker)
      .useValue(new InMemoryBreachChecker())
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    await playScenario(app);
  } finally {
    // Même en cas d'échec, compilation comprise : sinon Prisma, Redis et les exporteurs
    // retiennent le processus et le job de CI attend son délai au lieu d'échouer.
    // `close` appelle `shutdownTelemetry` (TelemetryShutdown) : spans, métriques et Sentry vidés.
    await app?.close();
    await provider?.close();
    await shutdownTelemetry();
    output.restore();
  }
  records = await fetchRecords(receiverUrl);
}, 60_000);

async function playScenario(app: INestApplication): Promise<void> {
  const http = request(app.getHttpServer());
  const marker = { marker: MARKER };

  // Session réelle (PostgreSQL et Redis) : chaque requête porte jeton, cookie et jeton CSRF.
  const user = await signIn(app, await createAccountWithProfile(app.get(PrismaService)));
  sessionSecrets.token = user.token;
  sessionSecrets.tokenHash = user.tokenHash;
  sessionSecrets.csrf = user.csrf;
  const authenticated = {
    ...markedHeaders,
    Cookie: `${user.cookie}; session=${MARKER}`,
    'X-CSRF-Token': user.csrf,
    Origin: 'http://localhost:3000',
  };

  // Pré-session (GET /session public) : identifiant et jeton CSRF de pré-session.
  const pre = await http.get('/api/v1/session').set(markedHeaders).expect(200);
  sessionSecrets.presessionCsrf = pre.body.csrfToken as string;
  const presessionCookie = ([] as string[])
    .concat((pre.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
    .find((cookie) => cookie.startsWith('__Host-lh_presession='));
  sessionSecrets.presessionId = decodeURIComponent(
    presessionCookie?.split(';')[0]?.split('=')[1] ?? '',
  );

  // Session lue, puis cache perdu : réhydratation par script Lua (arguments jamais exportés).
  await http.get('/api/v1/session').set(authenticated).expect(200);
  await app.get(RedisService).client.del(`sess:${user.tokenHash}`);
  await http.get('/api/v1/session').set(authenticated).expect(200);

  // CSRF refusé (jeton forgé porteur du marqueur) : écrit au journal de sécurité (SQL paramétré).
  await http
    .post('/api/v1/_leak/query-ok')
    .set({ ...authenticated, 'X-CSRF-Token': MARKER })
    .send(marker)
    .expect(403);

  // Contenu métier : titre, commentaire, URL d'article, montant (champs inconnus refusés, 400).
  await http
    .post(`/api/v1/example-items?url=${MARKER}`)
    .set(authenticated)
    .send({
      title: `Vélo ${MARKER}`,
      comment: `Pour ${MARKER}`,
      url: `https://boutique.example/velo?ref=${MARKER}`,
      amount: AMOUNT_MARKER,
    })
    .expect(400);

  // Création réussie : le titre passe par Prisma (paramètre SQL), puis relecture.
  const created = await http
    .post('/api/v1/example-items')
    .set(authenticated)
    .send({ title: `Vélo ${MARKER}` })
    .expect(201);
  await http
    .get(`/api/v1/example-items/${created.body.id as string}`)
    .set(authenticated)
    .expect(200);

  // Chemin résolu porteur de marqueur, route trouvée (OBS-21) puis route inconnue.
  await http.get(`/api/v1/example-items/${MARKER}?url=${MARKER}`).set(authenticated).expect(400);
  await http.get(`/api/v1/${MARKER}/${AMOUNT_MARKER}`).set(authenticated).expect(404);

  // Erreur métier, comptée par code (OBS-25).
  await http.get(`/api/v1/example-items/${randomUUID()}`).set(authenticated).expect(404);

  // JSON invalide : le message de l'analyseur cite le corps reçu.
  await http
    .post('/api/v1/example-items')
    .set(authenticated)
    .set('Content-Type', 'application/json')
    .send(`{"title": "${MARKER}`)
    .expect(400);

  // Erreurs inattendues (OBS-25, OBS-45), SQL (OBS-23), métrique (OBS-20).
  await http.post('/api/v1/_leak/boom').set(authenticated).send(marker).expect(500);
  await http.post('/api/v1/_leak/query').set(authenticated).send(marker).expect(500);
  await http.post('/api/v1/_leak/query-ok').set(authenticated).send(marker).expect(200);
  await http.post('/api/v1/_leak/metric').set(authenticated).send(marker).expect(204);

  // `traceState` posé hors extraction, sur le parent et un lien (seconde barrière).
  await http.post('/api/v1/_leak/span-context').set(authenticated).send(marker).expect(204);

  // Commandes Redis porteuses du marqueur (clés, arguments de script).
  await http.post('/api/v1/_leak/redis').set(authenticated).send(marker).expect(204);

  // Appel sortant vers un tiers, dans le contexte de trace venu du client.
  await http.post('/api/v1/_leak/outbound').set(authenticated).expect(204);

  await playAuthScenario(app, pre.body.csrfToken as string, presessionCookie?.split(';')[0] ?? '');
  await playGoogleScenario(app);
  await playProfileScenario(app);
  await playLinkScenario(app);
  await playWardScenario(app);
}

/**
 * Compte sous tutelle (tranche 6 bis, lot d) : adresse et nom du profil enfant porteurs du
 * marqueur, lien d'installation dans l'e-mail puis dans le corps, mot de passe choisi, jeton
 * forgé (refus commun), réinitialisation par le tuteur, levée. Rien ne doit en sortir.
 */
async function playWardScenario(app: INestApplication): Promise<void> {
  const http = request(app.getHttpServer());
  const prisma = app.get(PrismaService);
  const lifecycle = app.get(SessionLifecycle);

  const tutor = await createAccountWithProfile(prisma);
  const signed = await signIn(app, tutor);
  const rotated = await lifecycle.rotate({
    id: signed.sessionId,
    accountId: tutor.accountId,
    tokenHash: signed.tokenHash,
  });
  const tutorSession = sessionHeaders(
    app,
    rotated.token,
    rotated.record.tokenHash,
    signed.sessionId,
    tutor.accountId,
    tutor.profileId,
  );
  const as = (session: { cookie: string; csrf: string }) => ({
    ...markedHeaders,
    Cookie: `${session.cookie}; session=${MARKER}`,
    'X-CSRF-Token': session.csrf,
    Origin: 'http://localhost:3000',
  });

  wardSecrets.wardEmail = `pupille_${MARKER}@example.test`.toLowerCase();
  wardSecrets.profileName = `Pupille ${MARKER}`;
  await http
    .post('/api/v1/account/wards')
    .set(as(tutorSession))
    .send({
      email: wardSecrets.wardEmail,
      profileName: wardSecrets.profileName,
      guardianAttested: true,
    })
    .expect(204);
  await background.flush();
  wardSecrets.setupToken = mail.lastToken(wardSecrets.wardEmail) ?? '';
  wardSecrets.setupTokenHash = createHash('sha256')
    .update(wardSecrets.setupToken, 'utf8')
    .digest('hex');
  wardSecrets.password = `mot de passe ${MARKER}`;

  const pre = await http.get('/api/v1/session').set(markedHeaders).expect(200);
  const presession =
    (pre.headers['set-cookie'] as unknown as string[] | undefined)
      ?.find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))
      ?.split(';')[0] ?? '';
  const anonymous = {
    ...markedHeaders,
    Cookie: presession,
    'X-CSRF-Token': pre.body.csrfToken as string,
    Origin: 'http://localhost:3000',
  };
  // Jeton forgé, puis installation légitime, puis rejeu : refus commun.
  await http
    .post('/api/v1/accounts/setup')
    .set(anonymous)
    .send({ token: randomBytes(32).toString('base64url'), password: wardSecrets.password })
    .expect(404);
  await http
    .post('/api/v1/accounts/setup')
    .set(anonymous)
    .send({ token: wardSecrets.setupToken, password: wardSecrets.password })
    .expect(204);
  await http
    .post('/api/v1/accounts/setup')
    .set(anonymous)
    .send({ token: wardSecrets.setupToken, password: wardSecrets.password })
    .expect(404);

  const ward = await prisma.account.findUniqueOrThrow({
    where: { email: wardSecrets.wardEmail },
    select: { id: true },
  });
  await http.get('/api/v1/account/wards').set(as(tutorSession)).expect(200);
  await http.get(`/api/v1/account/wards/${ward.id}`).set(as(tutorSession)).expect(200);
  await http
    .post(`/api/v1/account/wards/${ward.id}/password-reset`)
    .set(as(tutorSession))
    .expect(204);
  await http.post(`/api/v1/account/wards/${ward.id}/release`).set(as(tutorSession)).expect(204);
  await background.flush();
}

/**
 * Liens, cercle, invitations, blocage (tranche 6) : jeton d'invitation dans les corps, les
 * chemins et l'e-mail, adresse invitée, noms de profils porteurs du marqueur dans le cercle, les
 * liens et les blocages, jeton forgé (refus commun), marqueur enfant, validation parentale.
 */
async function playLinkScenario(app: INestApplication): Promise<void> {
  const http = request(app.getHttpServer());
  const prisma = app.get(PrismaService);
  const lifecycle = app.get(SessionLifecycle);

  const inviter = await createAccountWithProfile(prisma);
  const guest = await createAccountWithProfile(prisma);
  const kid = await createAccountWithProfile(prisma);
  await prisma.profile.update({
    where: { id: inviter.profileId },
    data: { displayName: `Invitant ${MARKER}` },
  });
  await prisma.profile.update({
    where: { id: guest.profileId },
    data: { displayName: `Invité ${MARKER}` },
  });
  await prisma.profile.update({
    where: { id: kid.profileId },
    data: { displayName: `Enfant ${MARKER}` },
  });
  let inviterSession = await signIn(app, inviter);
  const guestSession = await signIn(app, guest);
  const kidSession = await signIn(app, kid);
  const as = (signed: { cookie: string; csrf: string }) => ({
    ...markedHeaders,
    Cookie: `${signed.cookie}; session=${MARKER}`,
    'X-CSRF-Token': signed.csrf,
    Origin: 'http://localhost:3000',
  });

  // LNK-01 : invitation avec adresse ; jeton rendu une fois, hash en base.
  linkSecrets.invitedEmail = `invite_${MARKER}@example.test`.toLowerCase();
  const created = await http
    .post('/api/v1/invitations')
    .set(as(inviterSession))
    .send({ email: linkSecrets.invitedEmail })
    .expect(201);
  linkSecrets.token = created.body.token as string;
  linkSecrets.tokenHash = createHash('sha256').update(linkSecrets.token, 'utf8').digest('hex');
  await http.get('/api/v1/invitations').set(as(inviterSession)).expect(200);

  // LNK-07 : jeton forgé porteur du marqueur, refus commun ; jeton légitime lu puis ouvert.
  await http
    .post('/api/v1/invitations/inspect')
    .set(as(guestSession))
    .send({ token: MARKER })
    .expect(400);
  await http
    .post('/api/v1/invitations/redeem')
    .set(as(guestSession))
    .send({ token: randomBytes(16).toString('base64url') })
    .expect(404);
  await http
    .post('/api/v1/invitations/inspect')
    .set(as(guestSession))
    .send({ token: linkSecrets.token })
    .expect(200);
  const linked = await http
    .post('/api/v1/invitations/redeem')
    .set(as(guestSession))
    .send({ token: linkSecrets.token })
    .expect(201);
  // Rejeu : refus commun, rien n'est consommé.
  await http
    .post('/api/v1/invitations/redeem')
    .set(as(guestSession))
    .send({ token: linkSecrets.token })
    .expect(404);

  // LNK-09 : cercle et liens, noms porteurs du marqueur.
  await http.get('/api/v1/circle').set(as(guestSession)).expect(200);
  await http.get('/api/v1/links').set(as(inviterSession)).expect(200);

  // LNK-05 : blocage (supprime le lien), liste, levée.
  await http
    .post('/api/v1/blocks')
    .set(as(guestSession))
    .send({ profileId: inviter.profileId })
    .expect(204);
  await http.get('/api/v1/blocks').set(as(guestSession)).expect(200);
  await http.delete(`/api/v1/blocks/${inviter.profileId}`).set(as(guestSession)).expect(204);
  expect(linked.body.linkId).toBeTruthy();

  // PRO-09 : marqueur enfant, après une ré-authentification (rotation réelle).
  const rotated = await lifecycle.rotate({
    id: inviterSession.sessionId,
    accountId: inviter.accountId,
    tokenHash: inviterSession.tokenHash,
  });
  inviterSession = sessionHeaders(
    app,
    rotated.token,
    rotated.record.tokenHash,
    inviterSession.sessionId,
    inviter.accountId,
    inviter.profileId,
  );
  // PRO-12 : le compte garde un adulte, sinon le marquage serait refusé (`GUARDIAN_REQUIRED`).
  const guardian = await http
    .post('/api/v1/account/profiles')
    .set(as(inviterSession))
    .send({ displayName: `Parent ${MARKER}` })
    .expect(201);
  await http
    .put(`/api/v1/account/profiles/${inviter.profileId}/child`)
    .set(as(inviterSession))
    .send({ isChild: true })
    .expect(204);
  // PRO-05 : un enfant n'invite pas par e-mail.
  await http
    .post('/api/v1/invitations')
    .set(as(inviterSession))
    .send({ email: linkSecrets.invitedEmail })
    .expect(403);

  // LNK-06 : lien d'un enfant en attente de validation par un profil non enfant du compte.
  const childInvitation = await http
    .post('/api/v1/invitations')
    .set(as(inviterSession))
    .send({})
    .expect(201);
  linkSecrets.childToken = childInvitation.body.token as string;
  const pending = await http
    .post('/api/v1/invitations/redeem')
    .set(as(kidSession))
    .send({ token: linkSecrets.childToken })
    .expect(201);
  await http
    .post('/api/v1/session/profile')
    .set(as(inviterSession))
    .send({ profileId: guardian.body.id as string })
    .expect(200);
  await http.get('/api/v1/links').set(as(inviterSession)).expect(200);
  await http
    .post(`/api/v1/links/${pending.body.linkId as string}/approve`)
    .set(as(inviterSession))
    .expect(204);
  await http
    .delete(`/api/v1/links/${pending.body.linkId as string}`)
    .set(as(inviterSession))
    .expect(204);
}

/**
 * Profils et PIN (tranche 5) : PIN dans les corps (juste, faux, réinitialisé), hash en base,
 * compteur de PIN-03 en SQL brut, nonce de déverrouillage en cookie, nom de profil porteur du
 * marqueur. Rien ne doit en sortir.
 */
async function playProfileScenario(app: INestApplication): Promise<void> {
  const http = request(app.getHttpServer());
  const prisma = app.get(PrismaService);
  const { accountId, profileId } = await createAccountWithProfile(prisma);
  let user = await signIn(app, { accountId, profileId });
  const headers = () => ({
    ...markedHeaders,
    Cookie: `${user.cookie}; session=${MARKER}`,
    'X-CSRF-Token': user.csrf,
    Origin: 'http://localhost:3000',
  });
  pinSecrets.pin = randomPin();
  pinSecrets.wrongPin = randomPin();
  pinSecrets.resetPin = randomPin();

  // Espace Compte : profil créé avec un nom porteur du marqueur, liste des métadonnées.
  await http
    .post('/api/v1/account/profiles')
    .set(headers())
    .send({ displayName: `Profil ${MARKER}` })
    .expect(201);
  await http.get('/api/v1/account/profiles').set(headers()).expect(200);

  // PIN-04 : création du PIN, puis `EVERY_OPEN` (PATCH avec If-Match) et nom modifié.
  await http
    .put('/api/v1/profiles/me/pin')
    .set(headers())
    .send({ newPin: pinSecrets.pin })
    .expect(204);
  pinSecrets.pinHash =
    (await prisma.profile.findUniqueOrThrow({ where: { id: profileId } })).pinHash ?? '';
  // Revue SEC-40, C2-M3 : empreinte du PIN portée par le déverrouillage, écrite dans Redis.
  pinSecrets.pinStamp = createHash('sha256').update(pinSecrets.pinHash, 'utf8').digest('hex');
  await http
    .patch('/api/v1/profiles/me')
    .set(headers())
    .set('If-Match', '"1"')
    .send({ pinRelock: 'EVERY_OPEN', displayName: `Nom ${MARKER}` })
    .expect(200);

  // PRO-07 : PIN faux (compté en SQL brut), puis juste ; nonce de déverrouillage posé en cookie.
  await http
    .post('/api/v1/session/profile')
    .set(headers())
    .send({ profileId, pin: pinSecrets.wrongPin })
    .expect(422);
  const selected = await http
    .post('/api/v1/session/profile')
    .set(headers())
    .send({ profileId, pin: pinSecrets.pin })
    .expect(200);
  const unlockCookie = ([] as string[])
    .concat((selected.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
    .filter((cookie) => cookie.startsWith('__Host-lh_unlock='))
    .at(-1);
  pinSecrets.unlockNonce = decodeURIComponent(unlockCookie?.split(';')[0]?.split('=')[1] ?? '');
  await http
    .get('/api/v1/profiles/me')
    .set({ ...headers(), Cookie: `${user.cookie}; __Host-lh_unlock=${pinSecrets.unlockNonce}` })
    .expect(200);

  // PIN-04 : changement par l'ancien PIN, faux (compté) ; revue SEC-40, M1 : affaiblissement
  // du reverrouillage avec un PIN faux.
  const unlocked = () => ({
    ...headers(),
    Cookie: `${user.cookie}; __Host-lh_unlock=${pinSecrets.unlockNonce}`,
  });
  await http
    .put('/api/v1/profiles/me/pin')
    .set(unlocked())
    .send({ currentPin: pinSecrets.wrongPin, newPin: pinSecrets.resetPin })
    .expect(422);
  await http
    .patch('/api/v1/profiles/me')
    .set(unlocked())
    .set('If-Match', '"2"')
    .send({ pinRelock: 'NEVER', currentPin: pinSecrets.wrongPin })
    .expect(422);

  // PIN-03 (revue SEC-40, I4) : jusqu'au seuil, puis attente (429), ligne `pin.locked` et
  // e-mail au compte en tâche de fond.
  for (let i = 0; i < 3; i += 1) {
    await http
      .post('/api/v1/session/profile')
      .set(headers())
      .send({ profileId, pin: pinSecrets.wrongPin })
      .expect(422);
  }
  await http
    .post('/api/v1/session/profile')
    .set(headers())
    .send({ profileId, pin: pinSecrets.pin })
    .expect(429);
  await background.flush();
  if (background.failures.length > 0) throw new Error('tâche de fond en échec');
  if (!mail.sent.some((sent) => sent.subject.startsWith('Codes PIN'))) {
    throw new Error('avertissement PIN-03 absent');
  }

  // PIN-05 : ré-authentification (rotation réelle), réinitialisation (remet le compteur à zéro),
  // puis désactivation (nouvelle ré-authentification : la réinitialisation a verrouillé la
  // session, ce qui l'efface), verrouillage.
  const reauthenticate = async (): Promise<void> => {
    const rotated = await app.get(SessionLifecycle).rotate({
      id: user.sessionId,
      accountId,
      tokenHash: user.tokenHash,
    });
    user = sessionHeaders(
      app,
      rotated.token,
      rotated.record.tokenHash,
      user.sessionId,
      accountId,
      profileId,
    );
  };
  await reauthenticate();
  pinSecrets.reauthToken = user.token;
  await http
    .put(`/api/v1/account/profiles/${profileId}/pin/reset`)
    .set(headers())
    .send({ newPin: pinSecrets.resetPin })
    .expect(204);
  await http
    .post('/api/v1/session/profile')
    .set(headers())
    .send({ profileId, pin: pinSecrets.resetPin })
    .expect(200);
  await reauthenticate();
  await http.delete(`/api/v1/account/profiles/${profileId}/pin`).set(headers()).expect(204);
  await http.post('/api/v1/session/lock').set(headers()).expect(204);
}

/**
 * Google (tranche 4) : `code` et `state` dans la chaîne de requête d'un `GET`, affirmations de
 * Google en base, état du parcours dans Redis, ré-authentification. Rien ne doit en sortir.
 */
async function playGoogleScenario(app: INestApplication): Promise<void> {
  if (!provider) throw new Error('Fournisseur absent');
  const http = request(app.getHttpServer());
  const setCookies = (res: request.Response): string[] =>
    ([] as string[]).concat((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []);
  const cookieOf = (res: request.Response, name: string): string =>
    setCookies(res)
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.split(';')[0] ?? '';

  const pre = await http.get('/api/v1/session').set(markedHeaders).expect(200);
  const presession = cookieOf(pre, '__Host-lh_presession');
  const before = {
    ...markedHeaders,
    Cookie: `${presession}; session=${MARKER}`,
    'X-CSRF-Token': pre.body.csrfToken as string,
    Origin: 'http://localhost:3000',
  };
  googleSecrets.displayName = `Prénom ${MARKER} Google`;
  const started = await http
    .post('/api/v1/auth/google/start')
    .set(before)
    .send({ registration: { displayName: googleSecrets.displayName, ageAttested: true } })
    .expect(200);
  const url = new URL(started.body.authorizationUrl as string);
  googleSecrets.state = url.searchParams.get('state') ?? '';
  googleSecrets.nonce = url.searchParams.get('nonce') ?? '';
  googleSecrets.codeChallenge = url.searchParams.get('code_challenge') ?? '';
  googleSecrets.subject = `sub${randomBytes(12).toString('hex')}`;
  const email = `google_${MARKER}@gmail.test`;
  googleSecrets.googleEmail = email.toLowerCase();
  googleSecrets.clientSecret = provider.clientSecret;
  googleSecrets.code = provider.issueCode(url.href, { sub: googleSecrets.subject, email });

  // Retour forgé, porteur du marqueur partout : refusé, sans rien en dire.
  await http
    .get(
      `/api/v1/auth/google/callback?state=${MARKER}&code=${MARKER}&error=${MARKER}&error_description=${MARKER}`,
    )
    .set(before)
    .expect(303);
  // Retour légitime, avec des paramètres que Google ajoute.
  const signedIn = await http
    .get(
      `/api/v1/auth/google/callback?state=${googleSecrets.state}&code=${googleSecrets.code}&scope=openid%20email&authuser=0&prompt=none`,
    )
    .set(before)
    .expect(303);
  expect(new URL(signedIn.headers.location as string).searchParams.get('status')).toBe('signed_in');
  googleSecrets.codeVerifier = provider.tokenRequests.at(-1)?.code_verifier ?? '';
  const sessionCookie = cookieOf(signedIn, '__Host-lh_session');
  googleSecrets.googleSession = decodeURIComponent(sessionCookie.split('=')[1] ?? '');

  // Ré-authentification par Google, puis association refusée (déjà associé).
  const status = await http.get('/api/v1/session').set({ Cookie: sessionCookie }).expect(200);
  const session = {
    ...markedHeaders,
    Cookie: `${sessionCookie}; session=${MARKER}`,
    'X-CSRF-Token': status.body.csrfToken as string,
    Origin: 'http://localhost:3000',
  };
  const reauth = await http.post('/api/v1/auth/google/reauth').set(session).expect(200);
  const reauthUrl = new URL(reauth.body.authorizationUrl as string);
  googleSecrets.reauthState = reauthUrl.searchParams.get('state') ?? '';
  const reauthCode = provider.issueCode(reauthUrl.href, {
    sub: googleSecrets.subject,
    email,
    auth_time: Math.floor(Date.now() / 1000),
  });
  const reauthed = await http
    .get(`/api/v1/auth/google/callback?state=${googleSecrets.reauthState}&code=${reauthCode}`)
    .set(session)
    .expect(303);
  expect(new URL(reauthed.headers.location as string).searchParams.get('status')).toBe(
    'reauthenticated',
  );
  await http
    .get('/api/v1/account')
    .set({ Cookie: cookieOf(reauthed, '__Host-lh_session') })
    .expect(200);
}

/**
 * Comptes par mot de passe (tranche 2) : e-mail, mot de passe, nom et jetons passent par le corps,
 * la base (paramètres SQL), Redis (clés de limitation) et les e-mails ; rien ne doit en sortir.
 */
async function playAuthScenario(
  app: INestApplication,
  presessionCsrf: string,
  presessionCookie: string,
): Promise<void> {
  const http = request(app.getHttpServer());
  // Compteurs de limitation des exécutions précédentes (même adresse de test).
  const redis = await app.get(RedisService).ready();
  const stale = await redis.keys('rl*');
  if (stale.length > 0) await redis.del(...stale);

  const email = `${MARKER}@lahotte.test`;
  const password = `phrase ${MARKER} secrète`;
  const newPassword = `nouvelle ${MARKER} phrase`;
  authSecrets.email = email.toLowerCase();
  authSecrets.password = password;
  authSecrets.newPassword = newPassword;
  const before = {
    ...markedHeaders,
    Cookie: `${presessionCookie}; session=${MARKER}`,
    'X-CSRF-Token': presessionCsrf,
    Origin: 'http://localhost:3000',
  };

  await http
    .post('/api/v1/auth/register')
    .set(before)
    .send({ email, password, displayName: `Nom ${MARKER}`, ageAttested: true })
    .expect(202);
  await background.flush();
  authSecrets.verifyToken = mail.lastToken(email.toLowerCase()) ?? '';
  await http
    .post('/api/v1/auth/email/verify')
    .set(before)
    .send({ token: authSecrets.verifyToken })
    .expect(204);

  // Échec (journal de sécurité, compteurs), puis succès.
  await http
    .post('/api/v1/auth/login')
    .set(before)
    .send({ email, password: `faux ${MARKER} mot` })
    .expect(401);
  const login = await http
    .post('/api/v1/auth/login')
    .set(before)
    .send({ email, password })
    .expect(200);
  const sessionCookie = ([] as string[])
    .concat((login.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
    .find((cookie) => cookie.startsWith('__Host-lh_session='));
  authSecrets.loginSession = decodeURIComponent(sessionCookie?.split(';')[0]?.split('=')[1] ?? '');

  // Réinitialisation : jeton par e-mail, puis confirmation ; jeton forgé refusé (400).
  await http.post('/api/v1/auth/password/reset').set(before).send({ email }).expect(202);
  await background.flush();
  authSecrets.resetToken = mail.lastToken(email.toLowerCase()) ?? '';
  await http
    .post('/api/v1/auth/password/reset/confirm')
    .set(before)
    .send({ token: authSecrets.resetToken, newPassword })
    .expect(204);
  await http
    .post('/api/v1/auth/password/reset/confirm')
    .set(before)
    .send({ token: MARKER, newPassword })
    .expect(400);

  // Espace Compte : ré-authentification, changement d'e-mail (nouvelle adresse en tâche de fond),
  // changement de mot de passe, révocation d'une session inconnue, confirmation puis annulation.
  const sessionOf = (res: request.Response): Record<string, string> => {
    const token = ([] as string[])
      .concat((res.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
      .find((cookie) => cookie.startsWith('__Host-lh_session='))
      ?.split(';')[0];
    return {
      ...markedHeaders,
      Cookie: `${token ?? ''}; session=${MARKER}`,
      'X-CSRF-Token': res.body.csrfToken as string,
      Origin: 'http://localhost:3000',
    };
  };
  const relogged = await http
    .post('/api/v1/auth/login')
    .set(before)
    .send({ email, password: newPassword })
    .expect(200);
  const reauthed = await http
    .post('/api/v1/auth/reauth')
    .set(sessionOf(relogged))
    .send({ password: newPassword })
    .expect(200);
  const account = sessionOf(reauthed);
  const otherEmail = `autre_${MARKER}@lahotte.test`;
  authSecrets.otherEmail = otherEmail.toLowerCase();
  await http.put('/api/v1/auth/email').set(account).send({ email: otherEmail }).expect(202);
  await background.flush();
  authSecrets.cancelToken = mail.lastToken(email.toLowerCase()) ?? '';
  authSecrets.changeToken = mail.lastToken(otherEmail.toLowerCase()) ?? '';
  const thirdPassword = `troisième ${MARKER} phrase`;
  authSecrets.thirdPassword = thirdPassword;
  const changed = await http
    .put('/api/v1/auth/password')
    .set(account)
    .send({ newPassword: thirdPassword })
    .expect(200);
  await http.delete(`/api/v1/sessions/${randomUUID()}`).set(sessionOf(changed)).expect(404);

  // Second facteur (tranche 3) : secret, codes de secours, pré-authentification et appareil de
  // confiance passent par le corps, la base, Redis et les cookies ; rien ne doit en sortir.
  const totpSession = sessionOf(
    await http
      .post('/api/v1/auth/reauth')
      .set(sessionOf(changed))
      .send({ password: thirdPassword })
      .expect(200),
  );
  const enrolled = await http.post('/api/v1/auth/totp/enroll').set(totpSession).expect(200);
  secondFactorSecrets.totpSecret = enrolled.body.secret as string;
  const activated = await http
    .post('/api/v1/auth/totp/activate')
    .set(totpSession)
    .send({ code: await generate({ secret: secondFactorSecrets.totpSecret }) })
    .expect(200);
  const recoveryCodes = activated.body.recoveryCodes as string[];
  secondFactorSecrets.recoveryCode = recoveryCodes[0] ?? '';
  secondFactorSecrets.recoveryCodeRaw = secondFactorSecrets.recoveryCode.replace(/-/g, '');
  secondFactorSecrets.unusedRecoveryCode = (recoveryCodes[1] ?? '').replace(/-/g, '');
  const pendingLogin = await http
    .post('/api/v1/auth/login')
    .set(before)
    .send({ email, password: thirdPassword })
    .expect(200);
  const pendingCookie = ([] as string[])
    .concat((pendingLogin.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
    .find((cookie) => cookie.startsWith('__Host-lh_pending='))
    ?.split(';')[0];
  secondFactorSecrets.pendingToken = decodeURIComponent(pendingCookie?.split('=')[1] ?? '');
  const pending = { ...before, Cookie: `${before.Cookie}; ${pendingCookie ?? ''}` };
  // Code porteur du marqueur (refusé par la validation), puis code faux (compté), puis juste.
  await http.post('/api/v1/auth/totp/verify').set(pending).send({ code: MARKER }).expect(400);
  await http.post('/api/v1/auth/totp/verify').set(pending).send({ code: '000000' }).expect(401);
  const trusted = await http
    .post('/api/v1/auth/totp/verify')
    .set(pending)
    .send({ code: secondFactorSecrets.recoveryCode, trustDevice: true })
    .expect(200);
  const deviceCookie = ([] as string[])
    .concat((trusted.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
    .find((cookie) => cookie.startsWith('__Host-lh_device='))
    ?.split(';')[0];
  secondFactorSecrets.deviceToken = decodeURIComponent(deviceCookie?.split('=')[1] ?? '');
  const trustedSession = sessionOf(trusted);
  const devices = await http
    .get('/api/v1/trusted-devices')
    .set({ ...trustedSession, Cookie: `${trustedSession.Cookie ?? ''}; ${deviceCookie ?? ''}` })
    .expect(200);
  await http.get('/api/v1/account').set(trustedSession).expect(200);
  await http
    .delete(`/api/v1/trusted-devices/${(devices.body.items as { id: string }[])[0]?.id ?? ''}`)
    .set(trustedSession)
    .expect(204);

  await http
    .post('/api/v1/auth/email/verify')
    .set(before)
    .send({ token: authSecrets.changeToken })
    .expect(204);
  await http
    .post('/api/v1/auth/email/cancel')
    .set(before)
    .send({ token: authSecrets.cancelToken })
    .expect(204);
  await background.flush();
  expect(background.failures).toEqual([]);
}

describe('OBS-26 non-fuite de la télémétrie, application montée', () => {
  it('le test parle bien aux faux récepteurs', () => {
    expect(leakTelemetryEnv.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(receiverUrl);
  });

  it('journaux (OBS-01, OBS-21, OBS-45) : gabarit de route, erreur sans message', () => {
    const lines = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const routes = lines.map((line) => line.route);
    expect(routes).toContain('/api/v1/example-items/:id');
    expect(routes).toContain('/api/v1/_leak/boom');
    const errTypes = lines.map((line) => (line.err as { type?: string } | undefined)?.type);
    expect(errTypes).toContain('TypeError');
    expect(lines.some((line) => typeof line.trace_id === 'string')).toBe(true);

    expect(findMarker(logLines.join(''))).toBeUndefined();
  });

  it('sortie du processus hors pino (console, stdout, stderr) : rien du marqueur', () => {
    const text = output.text();
    for (const channel of ['stdout', 'stderr', 'console']) {
      expect(text).toContain(`${CAPTURE_PROBE}:${channel}`);
    }
    expect(findMarker(text)).toBeUndefined();
  });

  it('spans (OBS-22, OBS-23, OBS-29) : requêtes HTTP et Prisma tracées, sans contenu', () => {
    const traces = bodies('traces');
    expect(traces).toContain('/api/v1/_leak/boom');
    expect(traces).toContain('/api/v1/example-items/:id');
    expect(traces).toMatch(/prisma:engine:db_query/);
    expect(traces).toContain('leak-span-context');

    expect(findMarker(traces)).toBeUndefined();
  });

  it('métriques (OBS-20) : compteurs présents, étiquettes interdites retirées', () => {
    const metrics = bodies('metrics');
    expect(metrics).toContain('wishlist.domain_errors');
    expect(metrics).toContain('LEAK_TEST');
    expect(metrics).toContain('"conflict"');
    // La liste blanche laisse passer les étiquettes de l'instrumentation HTTP (gabarit de route).
    expect(metrics).toContain('http.server.request.duration');
    expect(metrics).toContain('/api/v1/example-items/:id');
    // Ni clé libre, ni nom hors liste, ni hôte d'un appel sortant (`server.address`, posé par la
    // métrique client de l'instrumentation HTTP).
    expect(metrics).not.toContain('"liste"');
    expect(metrics).not.toContain('wishlist.part');
    expect(metrics).not.toContain('wishlist.liste_');
    expect(metrics).not.toContain('server.address');

    expect(findMarker(metrics)).toBeUndefined();
  });

  it('SentryErrorReporter (OBS-45) : le SDK ne reçoit qu’une copie nettoyée', () => {
    expect(handedToSdk).toHaveLength(2);
    expect(findMarker(handedToSdk.join('\n'))).toBeUndefined();
  });

  it('événements d’erreur (OBS-25, OBS-28, OBS-45) : un par 5xx, rien de la requête', () => {
    const events = errorEvents();
    // Une par 5xx, et ce sont bien elles : la route `boom` et la requête SQL refusée. L'exception
    // principale est la dernière de `values` (les causes la précèdent).
    const mainTypes = events.map((event) => event.exception?.values?.at(-1)?.type).sort();
    expect(mainTypes).toEqual(['PrismaClientKnownRequestError', 'TypeError']);
    // `beforeSend` reconstruit l'événement en liste blanche : ni requête, ni utilisateur, ni
    // `extra`, ni nom de machine, ni transaction.
    const keys = new Set(events.flatMap((event) => Object.keys(event)));
    expect([...keys].filter((key) => !ALLOWED_EVENT_KEYS.has(key))).toEqual([]);

    expect(findMarker(bodies('errors'))).toBeUndefined();
  });

  it('OBS-12 : l’événement d’erreur porte le trace_id d’une trace exportée', () => {
    const traces = bodies('traces');
    const traceIds = errorEvents().map((event) => event.contexts?.trace?.trace_id);
    expect(traceIds.length).toBeGreaterThan(0);
    for (const traceId of traceIds) {
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(traces).toContain(traceId);
    }
  });

  it('appel sortant (OBS-29) : traceparent propagé, rien du client (tracestate, baggage)', () => {
    const outbound = records.filter((record) => record.channel === 'outbound');
    expect(outbound).toHaveLength(1);
    const headers = JSON.parse(outbound[0]?.body ?? '{}') as Record<string, string>;
    // Même trace que le client (corrélation), nouveau span parent.
    expect(headers.traceparent).toMatch(new RegExp(`^00-${CLIENT_TRACE_ID}-[0-9a-f]{16}-01$`));
    expect(headers).not.toHaveProperty('tracestate');
    expect(headers).not.toHaveProperty('baggage');
    expect(headers).not.toHaveProperty('sentry-trace');
    expect(findMarker(outbound[0]?.body ?? '')).toBeUndefined();
  });

  it('ADR 0013 : jeton, hash, cookies, X-CSRF-Token et pré-session absents de toute sortie', () => {
    expect(Object.keys(sessionSecrets).sort()).toEqual(
      ['csrf', 'presessionCsrf', 'presessionId', 'token', 'tokenHash'].sort(),
    );
    const everything = [
      logLines.join(''),
      output.text(),
      handedToSdk.join('\n'),
      records.map((record) => record.body).join('\n'),
    ].join('\n');
    for (const [name, secret] of Object.entries(sessionSecrets)) {
      expect(secret.length).toBeGreaterThan(20);
      expect({ name, leaked: everything.includes(secret) }).toEqual({ name, leaked: false });
    }
  });

  it('SEC-31, ADR 0013 : e-mail, mots de passe et jetons d’authentification absents de toute sortie', () => {
    expect(Object.keys(authSecrets).sort()).toEqual(
      [
        'cancelToken',
        'changeToken',
        'email',
        'loginSession',
        'newPassword',
        'otherEmail',
        'password',
        'resetToken',
        'thirdPassword',
        'verifyToken',
      ].sort(),
    );
    const everything = [
      logLines.join(''),
      output.text(),
      handedToSdk.join('\n'),
      records.map((record) => record.body).join('\n'),
    ].join('\n');
    // Les routes d'authentification ont bien été tracées (pas de faux vert).
    for (const route of ['/api/v1/auth/login', '/api/v1/auth/email', '/api/v1/sessions/:id']) {
      expect(bodies('traces')).toContain(route);
    }
    for (const [name, secret] of Object.entries(authSecrets)) {
      expect(secret.length).toBeGreaterThan(20);
      expect({ name, leaked: everything.includes(secret) }).toEqual({ name, leaked: false });
    }
  });

  it('AUTH-10 à AUTH-12, SEC-22 : secret TOTP, codes de secours et jetons du second facteur absents de toute sortie', () => {
    expect(Object.keys(secondFactorSecrets).sort()).toEqual(
      [
        'deviceToken',
        'pendingToken',
        'recoveryCode',
        'recoveryCodeRaw',
        'totpSecret',
        'unusedRecoveryCode',
      ].sort(),
    );
    const everything = [
      logLines.join(''),
      output.text(),
      handedToSdk.join('\n'),
      records.map((record) => record.body).join('\n'),
    ].join('\n');
    // Les routes du second facteur ont bien été tracées (pas de faux vert).
    for (const route of [
      '/api/v1/auth/totp/verify',
      '/api/v1/auth/totp/activate',
      '/api/v1/trusted-devices/:id',
    ]) {
      expect(bodies('traces')).toContain(route);
    }
    for (const [name, secret] of Object.entries(secondFactorSecrets)) {
      expect(secret.length).toBeGreaterThanOrEqual(16);
      expect({ name, leaked: everything.includes(secret) }).toEqual({ name, leaked: false });
    }
  });

  it('AUTH-03, ADR 0013 : code, state, nonce, PKCE, secret du client et affirmations de Google absents de toute sortie', () => {
    expect(Object.keys(googleSecrets).sort()).toEqual(
      [
        'clientSecret',
        'code',
        'codeChallenge',
        'codeVerifier',
        'displayName',
        'googleEmail',
        'googleSession',
        'nonce',
        'reauthState',
        'state',
        'subject',
      ].sort(),
    );
    const everything = [
      logLines.join(''),
      output.text(),
      handedToSdk.join('\n'),
      records.map((record) => record.body).join('\n'),
    ].join('\n');
    // Les routes Google ont bien été tracées (pas de faux vert).
    for (const route of [
      '/api/v1/auth/google/start',
      '/api/v1/auth/google/callback',
      '/api/v1/auth/google/reauth',
    ]) {
      expect(bodies('traces')).toContain(route);
    }
    for (const [name, secret] of Object.entries(googleSecrets)) {
      expect(secret.length).toBeGreaterThanOrEqual(16);
      expect({ name, leaked: everything.includes(secret) }).toEqual({ name, leaked: false });
    }
  });

  it('PIN-01 à PIN-07 : PIN, hash du PIN, nonce de déverrouillage absents de toute sortie', () => {
    expect(Object.keys(pinSecrets).sort()).toEqual(
      ['pin', 'pinHash', 'pinStamp', 'reauthToken', 'resetPin', 'unlockNonce', 'wrongPin'].sort(),
    );
    const everything = [
      logLines.join(''),
      output.text(),
      handedToSdk.join('\n'),
      records.map((record) => record.body).join('\n'),
    ].join('\n');
    // Les routes des profils ont bien été tracées (pas de faux vert).
    for (const route of [
      '/api/v1/session/profile',
      '/api/v1/profiles/me/pin',
      '/api/v1/account/profiles/:id/pin/reset',
      '/api/v1/account/profiles/:id/pin',
    ]) {
      expect(bodies('traces')).toContain(route);
    }
    for (const name of ['pin', 'wrongPin', 'resetPin']) {
      const pin = pinSecrets[name] ?? '';
      expect(pin).toMatch(/^[0-9]{8}$/);
      const leaked = new RegExp(`(?<!\\d)${pin}(?!\\d)`).test(everything);
      expect({ name, leaked }).toEqual({ name, leaked: false });
    }
    for (const name of ['pinHash', 'pinStamp', 'unlockNonce', 'reauthToken']) {
      const secret = pinSecrets[name] ?? '';
      expect(secret.length).toBeGreaterThan(20);
      expect({ name, leaked: everything.includes(secret) }).toEqual({ name, leaked: false });
    }
    // OBS-02 : les refus d'autorisation (PIN faux, profil verrouillé) sont comptés.
    expect(bodies('metrics')).toContain('wishlist.authorization_denied');
    expect(bodies('metrics')).toContain('PIN_RATE_LIMITED');
  });

  it('LNK-01 à LNK-09 : jeton d’invitation, hash, adresse invitée absents de toute sortie', () => {
    expect(Object.keys(linkSecrets).sort()).toEqual(
      ['childToken', 'invitedEmail', 'token', 'tokenHash'].sort(),
    );
    const everything = [
      logLines.join(''),
      output.text(),
      handedToSdk.join('\n'),
      records.map((record) => record.body).join('\n'),
    ].join('\n');
    // Les routes des liens ont bien été tracées (pas de faux vert).
    for (const route of [
      '/api/v1/invitations',
      '/api/v1/invitations/redeem',
      '/api/v1/circle',
      '/api/v1/links/:id/approve',
      '/api/v1/blocks',
      '/api/v1/account/profiles/:id/child',
    ]) {
      expect(bodies('traces')).toContain(route);
    }
    for (const [name, secret] of Object.entries(linkSecrets)) {
      expect(secret.length).toBeGreaterThanOrEqual(16);
      expect({ name, leaked: everything.includes(secret) }).toEqual({ name, leaked: false });
    }
  });

  it('PRO-15, PRO-16 : adresse, nom, lien d’installation, mot de passe absents de toute sortie', () => {
    expect(Object.keys(wardSecrets).sort()).toEqual(
      ['password', 'profileName', 'setupToken', 'setupTokenHash', 'wardEmail'].sort(),
    );
    const everything = [
      logLines.join(''),
      output.text(),
      handedToSdk.join('\n'),
      records.map((record) => record.body).join('\n'),
    ].join('\n');
    // Les routes de la tutelle ont bien été tracées (pas de faux vert).
    for (const route of [
      '/api/v1/account/wards',
      '/api/v1/accounts/setup',
      '/api/v1/account/wards/:id/password-reset',
      '/api/v1/account/wards/:id/release',
    ]) {
      expect(bodies('traces')).toContain(route);
    }
    for (const [name, secret] of Object.entries(wardSecrets)) {
      expect(secret.length).toBeGreaterThanOrEqual(16);
      expect({ name, leaked: everything.includes(secret) }).toEqual({ name, leaked: false });
    }
  });

  it('ADR 0013, OBS-23 : commandes Redis tracées sans clé ni argument (sérialiseur de telemetry.ts, puis scrub)', () => {
    const traces = bodies('traces');
    // Spans `mget`, `eval` et `set` présents : l'instrumentation s'applique (pas de faux vert).
    for (const command of ['mget', 'eval', 'set']) {
      expect(traces).toContain(`"stringValue":"${command}"`);
    }
    expect(traces).not.toContain('sess:');
    expect(traces).not.toContain('sess-revoked:');
  });

  it('aucun autre canal, et aucun marqueur nulle part', () => {
    expect(
      records.filter(
        (record) => !['traces', 'metrics', 'errors', 'outbound'].includes(record.channel),
      ),
    ).toEqual([]);
    expect(findMarker(records.map((record) => record.body).join('\n'))).toBeUndefined();
  });
});
