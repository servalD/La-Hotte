/**
 * Nature d'une erreur métier. La présentation la traduit en statut HTTP (API-13) ;
 * le domaine ne connaît pas HTTP.
 */
export type DomainErrorKind =
  | 'not_found' // 404 — introuvable, ou interdit quand l'existence est un secret (SEC-04)
  | 'forbidden' // 403 — interdit, quand l'existence n'est pas un secret
  | 'conflict' // 409
  | 'precondition_failed' // 412 — version dépassée (API-17)
  | 'business_rule' // 422
  | 'locked'; // 423 — profil verrouillé par PIN

/**
 * Erreur métier. `code` est stable et exploité par le client (API-14) : SCREAMING_SNAKE_CASE,
 * jamais renommé. `message` ne contient aucune donnée d'utilisateur ni détail interne.
 */
export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
