import type { NewProfile } from './account';
import type { Guardianship, OpenWardSetup, WardSummary } from './ward';

/**
 * Comptes sous tutelle en base (PRO-15, PRO-16). Toute méthode qui prend `guardianAccountId` ne
 * touche qu'un compte dont c'est le tuteur : un autre compte est traité comme absent (SEC-04).
 */
export abstract class WardRepository {
  /** PRO-15 : tutelle du compte, `null` s'il n'est pas sous tutelle. */
  abstract guardianshipOf(accountId: string): Promise<Guardianship | null>;

  /** PRO-15 : le compte est tuteur d'au moins un compte. */
  abstract hasWards(accountId: string): Promise<boolean>;

  /**
   * PRO-15 : demande de création (`profile_transfer`, `kind = WARD`, nouveau profil), accords du
   * tuteur donnés des deux côtés. Le lien d'installation vaut jusqu'à `tokenExpiresAt`.
   */
  abstract createSetupRequest(input: {
    readonly id: string;
    readonly guardianAccountId: string;
    readonly email: string;
    readonly profileName: string;
    readonly tokenHash: string;
    readonly now: Date;
    readonly tokenExpiresAt: Date;
    readonly expiresAt: Date;
  }): Promise<void>;

  /** Demande ouverte dont le lien d'installation est valable, `null` sinon. */
  abstract findOpenSetup(tokenHash: string, now: Date): Promise<OpenWardSetup | null>;

  /**
   * PRO-15, en une transaction : la demande est servie (une seule fois), le compte naît vérifié,
   * sous tutelle, avec son profil enfant, lié par un lien de tutelle à chaque profil non enfant du
   * tuteur et par un lien ordinaire à ses profils enfants (LNK-11). `invalid` si la demande n'est
   * plus ouverte, `email_taken` si l'adresse a un compte ou est réservée (AUTH-16).
   */
  abstract completeSetup(input: {
    readonly tokenHash: string;
    readonly accountId: string;
    readonly passwordHash: string;
    readonly profile: NewProfile;
    readonly linkIds: () => string;
    readonly now: Date;
  }): Promise<
    | { readonly status: 'created'; readonly guardianAccountId: string }
    | { readonly status: 'invalid' | 'email_taken' }
  >;

  abstract listWards(guardianAccountId: string): Promise<WardSummary[]>;

  abstract findWard(guardianAccountId: string, wardAccountId: string): Promise<WardSummary | null>;

  /**
   * PRO-15, PRO-16 : profil enfant créé dans un compte sous tutelle (par le tuteur ou par le compte
   * lui-même), lié d'office au tuteur (LNK-11) ; une levée en attente est annulée.
   */
  abstract createWardProfile(input: {
    readonly wardAccountId: string;
    readonly profile: NewProfile;
    readonly linkIds: () => string;
    readonly now: Date;
  }): Promise<'created' | 'limit' | 'missing'>;

  /** PRO-16 : levée demandée, seulement pour un compte à un seul profil. */
  abstract requestRelease(
    guardianAccountId: string,
    wardAccountId: string,
    now: Date,
  ): Promise<'requested' | 'missing' | 'multiple_profiles'>;

  /**
   * PRO-16, AUTH-08, sous verrou du compte : la déclaration d'âge du compte fait effet à la levée
   * demandée. Le profil perd le marqueur enfant, les liens de tutelle deviennent des liens
   * ordinaires, les jetons de réinitialisation ouverts sont désarmés.
   */
  abstract attestAgeAndRelease(
    wardAccountId: string,
    now: Date,
  ): Promise<
    | {
        readonly status: 'released';
        readonly guardianAccountId: string;
        readonly profileId: string;
      }
    | { readonly status: 'not_requested' | 'multiple_profiles' }
  >;
}
