import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  AdminScope,
  ClientContext,
  type ClientContextValue,
  CurrentPlatformActor,
  type PlatformActor,
} from '../../identity';
import type { AuditScalar, AuditValue } from '../../../shared/domain';
import { ReadAudit } from '../application/read-audit.use-case';
import { AuditQueryDto } from './dto/audit.dto';
import { AuditPageView, type AuditValueView } from './dto/audit.view';

function viewScalar(value: AuditScalar): string | number | boolean | string[] | null {
  return Array.isArray(value)
    ? [...(value as readonly string[])]
    : (value as string | number | boolean | null);
}

function viewValue(value: AuditValue): AuditValueView {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const setting = value as { readonly key: string; readonly value: AuditScalar };
    return { key: setting.key, value: viewScalar(setting.value) };
  }
  return viewScalar(value as AuditScalar);
}

/** Journal d'audit (AUD-04, AUD-06), réservé à `ADMIN` (RBAC-02). */
@ApiTags('admin')
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly readAudit: ReadAudit) {}

  @Get()
  @AdminScope('audit.read')
  @ApiOkResponse({ type: AuditPageView })
  async listAuditEntries(
    @Query() query: AuditQueryDto,
    @CurrentPlatformActor() actor: PlatformActor,
    @ClientContext() client: ClientContextValue,
  ): Promise<AuditPageView> {
    const page = await this.readAudit.execute({
      actorAccountId: actor.accountId,
      ip: client.ip,
      filterActorAccountId: query.actorAccountId ?? null,
      action: query.action ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
      cursor: query.cursor ?? null,
      limit: query.limit ?? null,
    });
    return {
      items: page.items.map((r) => ({
        id: r.id,
        at: r.at.toISOString(),
        actorAccountId: r.actorAccountId,
        action: r.action,
        targetKind: r.targetKind,
        targetId: r.targetId,
        reason: r.reason,
        ip: r.ip,
        before: viewValue(r.before),
        after: viewValue(r.after),
      })),
      nextCursor: page.nextCursor,
    };
  }
}
