import { Module } from '@nestjs/common';
import { ReadAudit } from './application/read-audit.use-case';
import { AuditTrail } from './domain/audit-trail';
import { PrismaAuditTrail } from './infrastructure/prisma-audit-trail';
import { AdminAuditController } from './presentation/admin-audit.controller';

/**
 * Module `admin` (spec `11`, ADR 0021) : espace d'administration hors de tout profil. Aucune route
 * ne renvoie un contenu d'utilisateur (ADM-01) ; chaque action écrit son entrée d'audit dans sa
 * transaction (AUD-05).
 */
@Module({
  controllers: [AdminAuditController],
  providers: [ReadAudit, { provide: AuditTrail, useClass: PrismaAuditTrail }],
})
export class AdminModule {}
