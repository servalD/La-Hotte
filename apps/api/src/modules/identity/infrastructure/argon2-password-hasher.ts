import { randomBytes } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PasswordHasher } from '../domain/account.ports';

/** AUTH-02 : argon2id, 19 Mio, 2 passes, 1 fil (recommandation OWASP). */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Adaptateur argon2id. Sans hash, la vérification se fait contre un hash factice de mêmes
 * paramètres, tiré au démarrage (ADR 0013, « Anti-énumération ») : même coût, toujours faux.
 * Aucune erreur ne cite le mot de passe ; un hash illisible vaut un refus.
 */
@Injectable()
export class Argon2PasswordHasher extends PasswordHasher implements OnModuleInit {
  private dummy: Promise<string> | null = null;

  /** Tiré au démarrage : la première connexion sans compte ne dure pas plus que les autres. */
  async onModuleInit(): Promise<void> {
    await this.dummyHash();
  }

  async hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(stored: string | null, password: string): Promise<boolean> {
    if (stored === null) {
      await this.safeVerify(await this.dummyHash(), password);
      return false;
    }
    return this.safeVerify(stored, password);
  }

  private async safeVerify(stored: string, password: string): Promise<boolean> {
    try {
      return await verify(stored, password);
    } catch {
      return false;
    }
  }

  private dummyHash(): Promise<string> {
    this.dummy ??= hash(randomBytes(32).toString('base64url'), OPTIONS);
    return this.dummy;
  }
}
