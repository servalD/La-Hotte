import type { NewProfile } from './account';
import type { PinAttempt, ProfileChanges, ProfileDetails, ProfileMetadata } from './profile';

/**
 * Profils en base (PRO-01 à PRO-08, PIN-01 à PIN-05). Toute méthode prend le compte de la session
 * et ne touche qu'un profil de ce compte (SEC-03) : un profil d'un autre compte est traité comme
 * absent. Le hash du PIN ne sort que vers le vérificateur.
 */
export abstract class ProfileRepository {
  /** Identifiants des profils du compte, du plus ancien au plus récent (PRO-04). */
  abstract listIds(accountId: string): Promise<string[]>;

  abstract listMetadata(accountId: string): Promise<ProfileMetadata[]>;

  abstract findDetails(accountId: string, profileId: string): Promise<ProfileDetails | null>;

  /**
   * PRO-08 : nouveau profil, sous verrou du compte. `limit` si le compte a déjà 10 profils
   * (déclencheur `profile_limit_per_account` en dernier recours).
   */
  abstract create(
    accountId: string,
    profile: NewProfile & { readonly isChild: boolean },
    now: Date,
  ): Promise<'created' | 'limit'>;

  /**
   * PRO-03, API-17 : modification si `version` est toujours celle attendue ; la version augmente.
   * `stale` si elle a changé, `missing` si le profil n'existe pas (ou plus).
   */
  abstract update(
    accountId: string,
    profileId: string,
    expectedVersion: number,
    changes: ProfileChanges,
  ): Promise<
    | { readonly status: 'updated'; readonly profile: ProfileDetails }
    | { readonly status: 'stale' | 'missing' }
  >;

  /**
   * PRO-08 : suppression sous verrou du compte. `last` si c'est le dernier profil du compte,
   * `missing` s'il n'existe pas, `guardian_required` si elle laisserait un compte (hors tutelle)
   * avec des enfants seuls, ou un enfant d'un compte sous tutelle sans tuteur (PRO-12, PRO-15).
   */
  abstract delete(
    accountId: string,
    profileId: string,
  ): Promise<'deleted' | 'last' | 'missing' | 'guardian_required'>;

  /**
   * PRO-09, sous verrou du compte : marqueur « profil enfant », changé depuis l'espace Compte
   * seulement ; la version augmente, `child_changed_at` et la notice sont posés, les demandes de
   * passage ouvertes du profil annulées ; vers « enfant », l'adresse du profil est effacée
   * (PRO-10). `ward` dans un compte sous tutelle (PRO-15), `guardian_required` comme `delete`.
   */
  abstract setChild(
    accountId: string,
    profileId: string,
    isChild: boolean,
    now: Date,
  ): Promise<'updated' | 'missing' | 'ward' | 'guardian_required'>;

  /**
   * PIN-03 : essai compté **avant** d'être évalué, en une seule écriture conditionnelle. Hors
   * attente, le compteur augmente et, s'il atteint le seuil, l'attente suivante est posée tout de
   * suite (`lockStepsMs`, indexée depuis le seuil). Pendant l'attente, rien n'est écrit. Le
   * compteur des erreurs depuis la dernière entrée augmente avec lui. `null` si le profil n'existe
   * pas.
   */
  abstract countPinAttempt(
    accountId: string,
    profileId: string,
    now: Date,
  ): Promise<PinAttempt | null>;

  /**
   * PIN juste : compteur et attente remis à zéro, seulement si le hash est toujours celui vérifié
   * (un PIN réinitialisé entre-temps ne déverrouille pas) ; l'essai juste, compté d'avance, est
   * retiré des erreurs depuis la dernière entrée, qui restent. Faux si le hash a changé.
   */
  abstract recordPinSuccess(
    accountId: string,
    profileId: string,
    verifiedHash: string,
  ): Promise<boolean>;

  /**
   * PIN-03 : PIN faux saisis depuis la dernière entrée, lus et remis à zéro en une écriture, à
   * l'entrée dans le profil seulement (ni un changement de PIN ni un réglage ne les effacent).
   */
  abstract takeFailuresSinceEntry(accountId: string, profileId: string): Promise<number>;

  /**
   * PIN-04, PIN-05 : nouveau hash (ou `null` pour désactiver), compteur et attente remis à zéro.
   * `expectedHash` : le hash vérifié (changement par l'ancien PIN), `null` pour un profil sans PIN,
   * `undefined` pour l'espace Compte (quel qu'il soit). `resetNoticeAt` est **écrit tel quel** :
   * une date depuis l'espace Compte, `null` quand le profil se redonne lui-même un PIN (PIN-05 : la
   * notice ne s'efface que par lui). Renvoie l'empreinte du nouveau PIN (PIN-05) ; `null` si le
   * profil n'existe pas ou si son hash a changé.
   */
  abstract setPin(input: {
    readonly accountId: string;
    readonly profileId: string;
    readonly pinHash: string | null;
    readonly expectedHash?: string | null;
    readonly resetNoticeAt: Date | null;
  }): Promise<{ readonly pinStamp: string | null } | null>;
}
