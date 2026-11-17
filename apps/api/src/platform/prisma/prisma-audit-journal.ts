import { Injectable } from '@nestjs/common';
import { AuditJournal, type AuditWrite } from '../../shared/domain';
import { appendAudit } from './audit-writer';
import { PrismaService } from './prisma.service';

/** AUD-05 : entrée écrite seule (suite d'une action qui a échoué). */
@Injectable()
export class PrismaAuditJournal extends AuditJournal {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  append(write: AuditWrite): Promise<void> {
    return appendAudit(this.prisma, write);
  }
}
