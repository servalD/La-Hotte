/** Client d'une requête : adresse retenue par `trust proxy` (SEC-30) et agent utilisateur. */
export interface ClientInfo {
  readonly ip: string;
  readonly userAgent: string;
}
