import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Metrics } from '../../../shared/domain';
import { PasswordBreachChecker } from '../domain/account.ports';

/** Service public de Have I Been Pwned (plage par préfixe, sans clé). Adresse fixe, jamais d'utilisateur. */
const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 3_000;
/** Réponse attendue : quelques centaines de lignes ; au-delà, refus de lire. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * AUTH-02 : k-anonymat. Seuls les 5 premiers caractères du SHA-1 quittent le serveur ; le reste
 * est comparé ici. `Add-Padding` : la taille de la réponse ne dit rien du préfixe (les lignes de
 * bourrage ont un compte nul). Sans réponse en 3 secondes, le mot de passe est accepté et la
 * panne comptée (`01`, AUTH-02). Ni le préfixe ni le mot de passe ne sont journalisés ; `fetch`
 * (undici) n'est pas instrumenté, l'URL ne part donc dans aucun span.
 */
/** Corps lu par morceaux, abandonné dès que `max` octets sont dépassés (sans tout charger). */
async function readBounded(stream: ReadableStream<Uint8Array>, max: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error('Réponse trop longue');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

@Injectable()
export class HibpBreachChecker extends PasswordBreachChecker {
  private readonly logger = new Logger(HibpBreachChecker.name);

  constructor(private readonly metrics: Metrics) {
    super();
  }

  async isBreached(password: string): Promise<boolean> {
    const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    try {
      const response = await fetch(`${RANGE_URL}${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'la-hotte' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok || !response.body) throw new Error('Réponse inattendue');
      const body = await readBounded(response.body, MAX_BODY_BYTES);
      return body.split('\n').some((line) => {
        const [candidate, count] = line.trim().split(':');
        return candidate === suffix && Number(count) > 0;
      });
    } catch {
      this.metrics.increment('wishlist.password_breach_check_unavailable');
      this.logger.warn('Vérification des fuites sans réponse : mot de passe accepté sans elle');
      return false;
    }
  }
}
