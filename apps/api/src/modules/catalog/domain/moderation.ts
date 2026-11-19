import { normalizeTerm } from '../../../shared/domain';
import type { ModerationStatus, Product } from './product';

/** Listes du contrôle automatique (MOD-09), lues dans les réglages de plateforme (ADM-09). */
export interface ModerationLists {
  readonly forbiddenTerms: readonly string[];
  readonly blockedDomains: readonly string[];
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/**
 * MOD-09 : un terme interdit dans le titre, la description ou le marchand (sans accent ni casse,
 * en mot ou en expression entière), ou un domaine bloqué (ou l'un de ses sous-domaines).
 */
export function contentFlagged(
  product: Pick<Product, 'title' | 'description' | 'merchant' | 'sourceUrl'>,
  lists: ModerationLists,
): boolean {
  const text = ` ${normalizeTerm(
    `${product.title} ${product.description} ${product.merchant ?? ''}`,
  )
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')} `;
  if (lists.forbiddenTerms.some((term) => term.length > 0 && text.includes(` ${term} `))) {
    return true;
  }
  const host = hostOf(product.sourceUrl);
  return (
    host !== null &&
    lists.blockedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  );
}

/**
 * MOD-06 : statut à la publication au catalogue global. Visible tout de suite seulement pour un
 * lien marchand dont l'extraction a réussi et que le contrôle automatique laisse passer ; tout le
 * reste (photo, saisie à la main, extraction échouée, contenu signalé par le contrôle) va en file.
 */
export function statusOnPublish(
  product: Pick<
    Product,
    'source' | 'extractionStatus' | 'title' | 'description' | 'merchant' | 'sourceUrl'
  >,
  lists: ModerationLists,
): Extract<ModerationStatus, 'APPROVED' | 'PENDING'> {
  if (product.source !== 'LINK' || product.extractionStatus !== 'DONE') return 'PENDING';
  return contentFlagged(product, lists) ? 'PENDING' : 'APPROVED';
}

/** Une fiche publiée au catalogue global pour la même adresse (MOD-05). */
export interface GlobalMember {
  readonly productId: string;
  readonly ownerProfileId: string | null;
  /** Compte de l'auteur ; `null` si l'auteur est effacé (RGPD-12) : il ne compte pas. */
  readonly accountId: string | null;
}

/**
 * Une fiche publiée au catalogue global (la plus ancienne de son adresse) ; `adopters` compte des
 * comptes distincts (MOD-05). `members` : toutes les fiches publiées de l'adresse, la montrée
 * comprise ; le compteur se recalcule par lecteur sur celles qu'il peut voir (REP-10).
 */
export interface GlobalEntry {
  readonly product: Product;
  readonly adopters: number;
  readonly members: readonly GlobalMember[];
}

/** MOD-12, REP-04 : qui publie (profil enfant, compte dont la publication est suspendue). */
export interface Publisher {
  readonly isChild: boolean;
  readonly publicationSuspended: boolean;
}

export abstract class PublisherPolicy {
  /** `null` si le profil n'existe plus. */
  abstract of(profileId: string): Promise<Publisher | null>;
}
