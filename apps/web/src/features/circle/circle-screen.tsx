'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  CircleMemberViewSource,
  getGetCircleQueryKey,
  getListBlocksQueryKey,
  getListLinksQueryKey,
  type LinkItemView,
  LinkItemViewRole,
  LinkItemViewStatus,
  useApproveLink,
  useBlockProfile,
  useDeleteLink,
  useGetCircle,
  useListBlocks,
  useListLinks,
  useUnblockProfile,
} from '@wishlist/api-client';
import { useTranslations } from 'next-intl';
import { ConfirmButton } from '@/components/confirm-button';
import { Button } from '@/components/ui/button';
import { ProfileAvatar } from '@/features/profiles/profile-avatar';

function Row({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
      {children}
    </li>
  );
}

/**
 * Cercle d'un profil (LNK-01 à LNK-09) : profils du compte, liens, validations parentales,
 * blocages. L'affichage suit ce que l'API rend : un nom absent (enfant, lien non accepté) reste
 * absent (PRO-05).
 */
export function CircleScreen() {
  const t = useTranslations('circle');
  const queryClient = useQueryClient();
  const circle = useGetCircle();
  const links = useListLinks();
  const blocks = useListBlocks();
  const approve = useApproveLink();
  const removeLink = useDeleteLink();
  const block = useBlockProfile();
  const unblock = useUnblockProfile();

  const refresh = () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetCircleQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListLinksQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() }),
    ]);
  };

  const own = circle.data?.items.filter((m) => m.source === CircleMemberViewSource.ACCOUNT) ?? [];
  const items = links.data?.items ?? [];
  const toApprove = items.filter((l) => l.awaitingMyApproval);

  const statusLabel = (link: LinkItemView) =>
    link.status === LinkItemViewStatus.ACCEPTED
      ? t('status.accepted')
      : link.status === LinkItemViewStatus.AWAITING_GUARDIAN
        ? t('status.awaitingGuardian')
        : t('status.pending');

  return (
    <div className="flex flex-col gap-8">
      {toApprove.length > 0 ? (
        <section aria-labelledby="approve-title" className="flex flex-col gap-3">
          <h2 id="approve-title" className="text-lg font-semibold">
            {t('approve.title')}
          </h2>
          <p className="text-sm text-foreground-muted">{t('approve.who')}</p>
          <ul className="flex flex-col gap-2">
            {toApprove.map((link) => (
              <Row key={link.id}>
                <p>
                  {link.child
                    ? t('approve.body', {
                        child: link.child.displayName,
                        other: link.counterpart.displayName ?? t('hiddenName'),
                      })
                    : t('approve.bodyGeneric')}
                </p>
                <div className="flex gap-2">
                  <Button
                    disabled={approve.isPending}
                    onClick={() => {
                      approve.mutate({ id: link.id }, { onSuccess: refresh });
                    }}
                  >
                    {t('approve.accept')}
                  </Button>
                  <ConfirmButton
                    variant="secondary"
                    label={t('approve.refuse')}
                    title={t('approve.refuseTitle')}
                    description={t('approve.refuseBody')}
                    confirmLabel={t('approve.refuse')}
                    cancelLabel={t('cancel')}
                    onConfirm={() => {
                      removeLink.mutate({ id: link.id }, { onSuccess: refresh });
                    }}
                  />
                </div>
              </Row>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="links-title" className="flex flex-col gap-3">
        <h2 id="links-title" className="text-lg font-semibold">
          {t('links.title')}
        </h2>
        <p className="text-sm text-foreground-muted">{t('links.who')}</p>
        {items.length === 0 ? <p>{t('links.none')}</p> : null}
        <ul className="flex flex-col gap-2">
          {items.map((link) => (
            <Row key={link.id}>
              <div className="flex items-center gap-3">
                <ProfileAvatar
                  name={link.counterpart.displayName ?? '?'}
                  color={link.counterpart.accentColor}
                  size={40}
                />
                <div>
                  <p className="font-medium">{link.counterpart.displayName ?? t('hiddenName')}</p>
                  <p className="text-sm text-foreground-muted">
                    {statusLabel(link)}
                    {link.role === LinkItemViewRole.GUARDIAN && link.child
                      ? ` · ${t('guardianOf', { child: link.child.displayName })}`
                      : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ConfirmButton
                  variant="secondary"
                  label={t('links.remove')}
                  title={t('links.removeTitle')}
                  description={t('links.removeBody')}
                  confirmLabel={t('links.remove')}
                  cancelLabel={t('cancel')}
                  onConfirm={() => {
                    removeLink.mutate({ id: link.id }, { onSuccess: refresh });
                  }}
                />
                <ConfirmButton
                  label={t('block.action')}
                  title={t('block.title')}
                  description={t('block.body')}
                  confirmLabel={t('block.action')}
                  cancelLabel={t('cancel')}
                  onConfirm={() => {
                    block.mutate(
                      { data: { profileId: link.counterpart.profileId } },
                      { onSuccess: refresh },
                    );
                  }}
                />
              </div>
            </Row>
          ))}
        </ul>
      </section>

      {own.length > 0 ? (
        <section aria-labelledby="own-title" className="flex flex-col gap-3">
          <h2 id="own-title" className="text-lg font-semibold">
            {t('own.title')}
          </h2>
          <p className="text-sm text-foreground-muted">{t('own.who')}</p>
          <ul className="flex flex-col gap-2">
            {own.map((member) => (
              <Row key={member.profileId}>
                <div className="flex items-center gap-3">
                  <ProfileAvatar name={member.displayName} color={member.accentColor} size={40} />
                  <p className="font-medium">{member.displayName}</p>
                </div>
              </Row>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="blocks-title" className="flex flex-col gap-3">
        <h2 id="blocks-title" className="text-lg font-semibold">
          {t('blocks.title')}
        </h2>
        <p className="text-sm text-foreground-muted">{t('blocks.who')}</p>
        {blocks.data?.items.length === 0 ? <p>{t('blocks.none')}</p> : null}
        <ul className="flex flex-col gap-2">
          {blocks.data?.items.map((entry) => (
            <Row key={entry.profileId}>
              <div className="flex items-center gap-3">
                <ProfileAvatar
                  name={entry.displayName ?? '?'}
                  color={entry.accentColor}
                  size={40}
                />
                <p className="font-medium">{entry.displayName ?? t('hiddenName')}</p>
              </div>
              <Button
                variant="secondary"
                disabled={unblock.isPending}
                onClick={() => {
                  unblock.mutate({ profileId: entry.profileId }, { onSuccess: refresh });
                }}
              >
                {t('blocks.lift')}
              </Button>
            </Row>
          ))}
        </ul>
      </section>
    </div>
  );
}
