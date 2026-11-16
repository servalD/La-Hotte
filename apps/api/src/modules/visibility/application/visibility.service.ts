import { Injectable } from '@nestjs/common';
import type { ListFacts } from '../domain/facts';
import { CircleFacts } from '../domain/ports';
import { type ListAccess, listAccess } from '../domain/rules';

/**
 * Critères de recherche des listes candidates d'un profil (VIS-31) : le dépôt lit les listes dont
 * il est membre ou destinataire, celles dont un destinataire est dans son cercle (audience
 * `CERCLE`) et celles qui le choisissent (`CUSTOM`). Chaque candidate repasse par `accessToList`.
 */
export interface ListCandidateCriteria {
  readonly viewerId: string;
  /** Le cercle du demandeur : symétrique (LNK-09), il désigne aussi les destinataires dont il est proche. */
  readonly circle: readonly string[];
}

/**
 * Seul point d'entrée des lectures (VIS-30, invariant 2) : complète les faits d'une liste par le
 * cercle du demandeur, puis laisse décider les règles pures du domaine.
 */
@Injectable()
export class VisibilityService {
  constructor(private readonly circle: CircleFacts) {}

  async accessToList(viewerId: string, list: ListFacts): Promise<ListAccess> {
    const direct = listAccess(list, { profileId: viewerId, inRecipientsCircle: false });
    if (direct.kind !== 'none' || list.audience !== 'CIRCLE') return direct;
    // Le cercle n'est lu que s'il peut changer la réponse.
    const inRecipientsCircle = await this.inCircleOfAny(viewerId, list.recipients);
    return listAccess(list, { profileId: viewerId, inRecipientsCircle });
  }

  async listCandidates(viewerId: string): Promise<ListCandidateCriteria> {
    return { viewerId, circle: await this.circle.membersOf(viewerId) };
  }

  /** Cercle du demandeur (LNK-09) : profils qu'il peut choisir comme membres ou dans une règle. */
  async circleOf(viewerId: string): Promise<readonly string[]> {
    return this.circle.membersOf(viewerId);
  }

  /** LST-07 : destinataires permis d'une wishlist (lui-même ou un profil de son compte). */
  sameAccount(profileId: string, otherProfileId: string): Promise<boolean> {
    return this.circle.sameAccount(profileId, otherProfileId);
  }

  private async inCircleOfAny(viewerId: string, recipients: readonly string[]): Promise<boolean> {
    for (const recipient of recipients) {
      if (await this.circle.inCircle(recipient, viewerId)) return true;
    }
    return false;
  }
}
