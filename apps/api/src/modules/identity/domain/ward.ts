/**
 * Compte sous tutelle (PRO-15, PRO-16, RGPD-06). Ce que le tuteur en voit : des métadonnées
 * seulement (PIN-08), jamais une liste, un élément ni une donnée d'offreur.
 */
import type { ProfileMetadata } from './profile';

/** Compte sous tutelle, vu par son tuteur. */
export interface WardSummary {
  readonly id: string;
  readonly email: string;
  readonly createdAt: Date;
  /** PRO-16 : levée demandée, en attente de la déclaration d'âge du compte. */
  readonly releaseRequested: boolean;
  readonly profiles: readonly ProfileMetadata[];
}

/** Demande de création d'un compte sous tutelle, ouverte, retrouvée par son lien d'installation. */
export interface OpenWardSetup {
  readonly transferId: string;
  readonly guardianAccountId: string;
  readonly email: string;
  readonly profileName: string;
  /** RGPD-06 : déclaration d'autorité parentale, faite à la demande. */
  readonly guardianAttestedAt: Date;
}

/** Tutelle d'un compte, telle que la lisent les avis (PRO-16). */
export interface Guardianship {
  readonly guardianAccountId: string;
  readonly guardianEmail: string;
}
