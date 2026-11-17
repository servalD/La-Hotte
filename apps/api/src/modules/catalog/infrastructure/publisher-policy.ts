import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { type Publisher, PublisherPolicy } from '../domain/moderation';

/** MOD-12 : profil enfant et suspension de publication du compte, lus en base à chaque appel. */
@Injectable()
export class PrismaPublisherPolicy extends PublisherPolicy {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async of(profileId: string): Promise<Publisher | null> {
    const row = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { isChild: true, account: { select: { publicationSuspendedAt: true } } },
    });
    if (!row) return null;
    return {
      isChild: row.isChild,
      publicationSuspended: row.account.publicationSuspendedAt !== null,
    };
  }
}

/** Double des tests : enfants et comptes suspendus déclarés par le banc. */
export class InMemoryPublisherPolicy extends PublisherPolicy {
  /** Profils suspendus de publication (MOD-10). */
  readonly suspended = new Set<string>();
  /** PRO-05 : branché par le banc sur les profils en mémoire d'`identity`. */
  isChildOf: (profileId: string) => boolean = () => false;

  of(profileId: string): Promise<Publisher | null> {
    return Promise.resolve({
      isChild: this.isChildOf(profileId),
      publicationSuspended: this.suspended.has(profileId),
    });
  }
}
