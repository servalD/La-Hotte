// OBS-26, volet B : processus lancé par `node --import dist/instrument.js`, comme l'API en
// production. Il meurt d'une exception non gérée ou d'un rejet non géré portant le marqueur, dans
// un span actif dont un attribut interdit le porte aussi.
// Usage : node --import <instrument> fatal-child.mjs <uncaught|rejection> <marqueur>
import { trace } from '@opentelemetry/api';
import * as Sentry from '@sentry/nestjs';
import { describeHandedError } from '../describe-handed-error.mjs';

const [mode, marker] = process.argv.slice(2);

// Ce que reçoit réellement `captureException`, écrit sur la sortie standard pour que le test y
// cherche le marqueur.
const client = Sentry.getClient();
if (!client) throw new Error('Sentry non démarré par instrument.js');
client.on('beforeSendEvent', (_event, hint) => {
  process.stdout.write(`SDK-RECU:${JSON.stringify(describeHandedError(hint.originalException))}\n`);
});

const error = Object.assign(
  new TypeError(`Échec pour ${marker}\n    at reserve (/cadeaux/${marker}:12:3)`),
  { query: `SELECT ${marker}`, meta: { target: marker } },
);
error.cause = new Error(`cause ${marker}`);

trace
  .getTracer('leak-test')
  .startActiveSpan(
    'fatal-test',
    { attributes: { 'url.full': `https://boutique.example/${marker}` } },
    (span) => {
      span.end();
      if (mode === 'uncaught') {
        setTimeout(() => {
          throw error;
        }, 0);
      } else {
        void Promise.reject(error);
      }
    },
  );

// Le processus doit être tenu en vie : c'est le gestionnaire d'erreurs fatales qui le fait sortir.
setTimeout(() => {}, 30_000);
