import type { ItemView, ListPermissions, ListSummary } from '../application/contract';
import type {
  ItemGiverView,
  ItemRecipientView,
  ItemViewDto,
  ListGiverView,
  ListPermissionsView,
  ListRecipientView,
  ListTeaserRecipientView,
  ListView,
} from './dto/list.view';

// Copie champ par champ des vues du moteur vers les DTO (jamais `...view` : un champ ajouté au
// domaine n'atteint une réponse que si on l'écrit ici).

function permissionsView(p: ListPermissions): ListPermissionsView {
  return {
    edit: p.edit,
    archive: p.archive,
    delete: p.delete,
    restore: p.restore,
    manageMembers: p.manageMembers,
    add: p.add,
    editRules: p.editRules,
    readLog: p.readLog,
  };
}

export function toListView(summary: ListSummary): ListView {
  const { list, access, permissions } = summary;
  switch (access.kind) {
    case 'gift_recipient': {
      const teaser: ListTeaserRecipientView = {
        view: 'teaser',
        id: list.id,
        content: access.content,
      };
      return teaser;
    }
    case 'recipient': {
      const view: ListRecipientView = {
        view: 'recipient',
        id: list.id,
        title: list.title,
        description: list.description,
        personal: list.personalProfileId !== null,
        recipients: [...list.recipients],
        myRole: access.role,
        audience: list.audience,
        customAudience: [...list.customAudience],
        defaultItemVisibility: list.defaultItemVisibility,
        visibilityEditRole: list.visibilityEditRole,
        archivedAt: list.archivedAt?.toISOString() ?? null,
        deletedAt: list.deletedAt?.toISOString() ?? null,
        createdAt: list.createdAt.toISOString(),
        version: list.version,
        permissions: permissionsView(permissions),
      };
      return view;
    }
    case 'none':
      // Écarté par `ListGate` ; jamais de vue pour une liste invisible.
      throw new Error('Liste invisible');
    case 'giver': {
      const view: ListGiverView = {
        view: 'giver',
        id: list.id,
        type: list.type,
        title: list.title,
        description: list.description,
        personal: list.personalProfileId !== null,
        recipients: [...list.recipients],
        myRole: access.role,
        audience: list.audience,
        customAudience: [...list.customAudience],
        defaultItemVisibility: list.defaultItemVisibility,
        visibilityEditRole: list.visibilityEditRole,
        giftExistence: list.giftExistence,
        giftContent: list.giftContent,
        archivedAt: list.archivedAt?.toISOString() ?? null,
        deletedAt: list.deletedAt?.toISOString() ?? null,
        createdAt: list.createdAt.toISOString(),
        version: list.version,
        permissions: permissionsView(permissions),
      };
      return view;
    }
  }
}

export function toItemView(item: ItemView): ItemViewDto {
  const product = {
    id: item.product.id,
    title: item.product.title,
    description: item.product.description,
    imageKey: item.product.imageKey,
    merchant: item.product.merchant,
    sourceUrl: item.product.sourceUrl,
  };
  if (item.view === 'recipient') {
    const view: ItemRecipientView = {
      view: 'recipient',
      id: item.id,
      listId: item.listId,
      product,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      currency: item.currency,
      priority: item.priority,
      note: item.note,
      manyWelcome: item.manyWelcome,
      hidden: item.hidden,
      received: item.received,
      receivedAt: item.receivedAt?.toISOString() ?? null,
      mine: item.mine,
      version: item.version,
    };
    return view;
  }
  const view: ItemGiverView = {
    view: 'giver',
    id: item.id,
    listId: item.listId,
    product,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    currency: item.currency,
    priority: item.priority,
    note: item.note,
    manyWelcome: item.manyWelcome,
    position: item.position,
    hidden: item.hidden,
    visibilityMode: item.visibilityMode,
    status: item.status,
    isSuggestion: item.isSuggestion,
    shownToRecipient: item.shownToRecipient,
    intendedRecipientId: item.intendedRecipientId,
    addedBy: item.addedBy,
    mine: item.mine,
    createdAt: item.createdAt.toISOString(),
    version: item.version,
  };
  return view;
}
