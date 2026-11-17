import {
  type CommentThread,
  getAddListItemUrl,
  getClaimContributionSettlementUrl,
  getCreateProductUrl,
  getDeleteItemContributionUrl,
  getDeleteOneItemUrl,
  getMarkItemReceivedUrl,
  getPostItemCommentUrl,
  getPutContributionSettlementUrl,
  getPutItemContributionUrl,
  getPutItemPurchaseUrl,
  getUnmarkItemReceivedUrl,
  getUpdateOneItemUrl,
  type SetContributionDto,
  type UpdateItemDto,
} from '@wishlist/api-client';
import type { QueuedInput } from './queue';

/**
 * Gestes de OFF-17, construits sur les URL du client généré (aucune URL écrite à la main). Le
 * corps est celui que la route attend ; `display` ne sert qu'à l'affichage de l'action en file.
 */
export const offlineActions = {
  comment(itemId: string, thread: CommentThread, body: string): QueuedInput {
    return {
      kind: 'comment.post',
      subject: { itemId, thread },
      display: { body },
      steps: [{ method: 'POST', url: getPostItemCommentUrl(itemId), body: { thread, body } }],
    };
  },

  /** Souhait saisi à la main : fiche, puis élément (deux étapes, deux clés). */
  addByHand(listId: string, title: string, unitPriceMinor: number | null): QueuedInput {
    return {
      kind: 'item.add',
      subject: { listId },
      display: { title, unitPriceMinor },
      steps: [
        {
          method: 'POST',
          url: getCreateProductUrl(),
          body: { title, ...(unitPriceMinor !== null ? { unitPriceMinor } : {}) },
        },
        { method: 'POST', url: getAddListItemUrl(listId), body: {}, productIdFromPrevious: true },
      ],
    };
  },

  /**
   * OFF-17 : un lien collé hors ligne entre comme une saisie ; la fiche est analysée au rejeu
   * (extraction lancée par la création de la fiche), sans passer par le brouillon.
   */
  addByLink(listId: string, url: string): QueuedInput {
    return {
      kind: 'item.add',
      subject: { listId },
      display: { url },
      steps: [
        { method: 'POST', url: getCreateProductUrl(), body: { url } },
        { method: 'POST', url: getAddListItemUrl(listId), body: {}, productIdFromPrevious: true },
      ],
    };
  },

  /** OFF-14 : la version lue part avec la modification ; dépassée, c'est un conflit. */
  updateItem(itemId: string, listId: string, version: number, changes: UpdateItemDto): QueuedInput {
    return {
      kind: 'item.update',
      subject: { itemId, listId },
      display: { version, ...flatten(changes) },
      steps: [
        {
          method: 'PATCH',
          url: getUpdateOneItemUrl(itemId),
          body: { ...changes },
          ifMatch: `"${String(version)}"`,
        },
      ],
    };
  },

  deleteItem(itemId: string, listId: string, title: string): QueuedInput {
    return {
      kind: 'item.delete',
      subject: { itemId, listId },
      display: { title },
      steps: [{ method: 'DELETE', url: getDeleteOneItemUrl(itemId) }],
    };
  },

  received(itemId: string, listId: string, received: boolean): QueuedInput {
    return {
      kind: received ? 'item.received' : 'item.unreceived',
      subject: { itemId, listId },
      display: {},
      steps: [
        {
          method: received ? 'POST' : 'DELETE',
          url: received ? getMarkItemReceivedUrl(itemId) : getUnmarkItemReceivedUrl(itemId),
        },
      ],
    };
  },

  contribute(itemId: string, input: SetContributionDto, amountMinor: number | null): QueuedInput {
    return {
      kind: 'contribution.put',
      subject: { itemId },
      display: { mode: input.mode, amountMinor },
      steps: [{ method: 'PUT', url: getPutItemContributionUrl(itemId), body: { ...input } }],
    };
  },

  withdrawContribution(itemId: string): QueuedInput {
    return {
      kind: 'contribution.delete',
      subject: { itemId },
      display: {},
      steps: [{ method: 'DELETE', url: getDeleteItemContributionUrl(itemId) }],
    };
  },

  purchase(itemId: string, actualTotalMinor: number | null): QueuedInput {
    return {
      kind: 'purchase.put',
      subject: { itemId },
      display: { actualTotalMinor },
      steps: [{ method: 'PUT', url: getPutItemPurchaseUrl(itemId), body: { actualTotalMinor } }],
    };
  },

  settle(contributionId: string, itemId: string | null, settled: boolean): QueuedInput {
    return {
      kind: 'settlement.put',
      subject: itemId ? { itemId } : {},
      display: { settled, contributionId },
      steps: [
        {
          method: 'PUT',
          url: getPutContributionSettlementUrl(contributionId),
          body: { settled },
        },
      ],
    };
  },

  claim(contributionId: string, itemId: string | null): QueuedInput {
    return {
      kind: 'settlement.claim',
      subject: itemId ? { itemId } : {},
      display: { contributionId },
      steps: [{ method: 'POST', url: getClaimContributionSettlementUrl(contributionId) }],
    };
  },
};

function flatten(changes: UpdateItemDto): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = value as string | number | boolean | null;
    }
  }
  return out;
}
