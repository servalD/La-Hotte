import { Injectable } from '@nestjs/common';
import { isPasswordLengthValid } from '../domain/account';
import { PasswordBreachedError, PasswordLengthError } from '../domain/account.errors';
import { PasswordBreachChecker, PasswordHasher } from '../domain/account.ports';

/**
 * AUTH-02 : longueur (aussi vérifiée par le DTO), fuites connues, puis argon2id. Renvoie le hash ;
 * le mot de passe n'est conservé nulle part.
 */
@Injectable()
export class PasswordPolicy {
  constructor(
    private readonly breaches: PasswordBreachChecker,
    private readonly hasher: PasswordHasher,
  ) {}

  async hashNew(password: string): Promise<string> {
    // Défense en profondeur : le DTO borne déjà la longueur.
    if (!isPasswordLengthValid(password)) throw new PasswordLengthError();
    if (await this.breaches.isBreached(password)) throw new PasswordBreachedError();
    return this.hasher.hash(password);
  }
}
