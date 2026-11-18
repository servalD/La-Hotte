import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AccountScope,
  AdminScope,
  ChangeAccountRole,
  ClientContext,
  type ClientContextValue,
  CurrentPlatformActor,
  CurrentSession,
  ForceLogout,
  type PlatformActor,
  ReactivateAccount,
  RequestTotpReset,
  RequiresRecentReauth,
  SuspendAccount,
} from '../../identity';
import type { PlatformSettingValues } from '../../../shared/domain';
import {
  ListAdminActionsOnAccount,
  ReadSettings,
  SearchAccount,
  UpdateSetting,
} from '../application/administer-platform.use-case';
import {
  AccountSearchQueryDto,
  AdminReasonDto,
  ChangeRoleDto,
  SettingKeyParams,
  UpdateSettingDto,
} from './dto/accounts.dto';
import {
  AccountSearchView,
  AdminActionsOnAccountView,
  PlatformSettingsView,
} from './dto/accounts.view';

const UUID_PARAM = { schema: { type: 'string', format: 'uuid' } } as const;

function settingsView(values: PlatformSettingValues): PlatformSettingsView {
  return {
    registration_mode: values.registration_mode,
    forbidden_terms: [...values.forbidden_terms],
    blocked_domains: [...values.blocked_domains],
    extraction_daily_limit: values.extraction_daily_limit,
  };
}

/** Comptes (ADM-04, ADM-06 à ADM-08, ADM-10, RBAC-03, RBAC-06, RBAC-07). */
@ApiTags('admin')
@Controller('admin/accounts')
export class AdminAccountsController {
  constructor(
    private readonly search: SearchAccount,
    private readonly suspend: SuspendAccount,
    private readonly reactivate: ReactivateAccount,
    private readonly forceLogout: ForceLogout,
    private readonly totpReset: RequestTotpReset,
    private readonly changeRole: ChangeAccountRole,
  ) {}

  @Get()
  @AdminScope('accounts.search')
  @ApiOkResponse({ type: AccountSearchView })
  async searchAccount(
    @Query() query: AccountSearchQueryDto,
    @CurrentPlatformActor() actor: PlatformActor,
    @ClientContext() client: ClientContextValue,
  ): Promise<AccountSearchView> {
    const found = await this.search.execute({
      actorAccountId: actor.accountId,
      ip: client.ip,
      email: query.email,
    });
    return {
      account: found
        ? {
            accountId: found.accountId,
            createdAt: found.createdAt.toISOString(),
            lastSignInAt: found.lastSignInAt?.toISOString() ?? null,
            profileCount: found.profileCount,
            listCount: found.listCount,
            role: found.role,
            status: found.status,
            totpEnabled: found.totpEnabled,
            emailVerified: found.emailVerified,
            publicationSuspended: found.publicationSuspended,
            suspensions: found.suspensions.map((s) => ({
              action: s.action,
              at: s.at.toISOString(),
            })),
          }
        : null,
    };
  }

  @Post(':id/suspend')
  @AdminScope('accounts.manage')
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async suspendAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminReasonDto,
    @CurrentPlatformActor() actor: PlatformActor,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.suspend.execute({
      actorAccountId: actor.accountId,
      targetAccountId: id,
      reason: body.reason,
      ip: client.ip,
    });
  }

  @Post(':id/reactivate')
  @AdminScope('accounts.manage')
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async reactivateAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminReasonDto,
    @CurrentPlatformActor() actor: PlatformActor,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.reactivate.execute({
      actorAccountId: actor.accountId,
      targetAccountId: id,
      reason: body.reason,
      ip: client.ip,
    });
  }

  @Post(':id/force-logout')
  @AdminScope('accounts.manage')
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async forceAccountLogout(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminReasonDto,
    @CurrentPlatformActor() actor: PlatformActor,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.forceLogout.execute({
      actorAccountId: actor.accountId,
      targetAccountId: id,
      reason: body.reason,
      ip: client.ip,
    });
  }

  @Post(':id/totp-reset')
  @AdminScope('accounts.manage')
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async requestAccountTotpReset(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminReasonDto,
    @CurrentPlatformActor() actor: PlatformActor,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.totpReset.execute({
      actorAccountId: actor.accountId,
      targetAccountId: id,
      reason: body.reason,
      ip: client.ip,
    });
  }

  @Put(':id/role')
  @AdminScope('roles.manage')
  @RequiresRecentReauth()
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async changeAccountRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangeRoleDto,
    @CurrentPlatformActor() actor: PlatformActor,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.changeRole.execute({
      actorAccountId: actor.accountId,
      targetAccountId: id,
      role: body.role,
      reason: body.reason,
      ip: client.ip,
    });
  }
}

/** Réglages de plateforme (ADM-09). */
@ApiTags('admin')
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(
    private readonly read: ReadSettings,
    private readonly update: UpdateSetting,
  ) {}

  @Get()
  @AdminScope('settings.manage')
  @ApiOkResponse({ type: PlatformSettingsView })
  getPlatformSettings(): PlatformSettingsView {
    return settingsView(this.read.execute());
  }

  @Put(':key')
  @AdminScope('settings.manage')
  @RequiresRecentReauth()
  @ApiParam({ name: 'key', schema: { type: 'string' } })
  @ApiOkResponse({ type: PlatformSettingsView })
  async updatePlatformSetting(
    @Param() params: SettingKeyParams,
    @Body() body: UpdateSettingDto,
    @CurrentPlatformActor() actor: PlatformActor,
    @ClientContext() client: ClientContextValue,
  ): Promise<PlatformSettingsView> {
    const values = await this.update.execute({
      actorAccountId: actor.accountId,
      ip: client.ip,
      key: params.key,
      value: body.value,
      reason: body.reason,
    });
    return settingsView(values);
  }
}

/** AUD-03, AUD-07 : le titulaire voit les actions d'administration faites sur son compte. */
@ApiTags('account')
@Controller('account/admin-actions')
export class AccountAdminActionsController {
  constructor(private readonly list: ListAdminActionsOnAccount) {}

  @Get()
  @AccountScope()
  @ApiOkResponse({ type: AdminActionsOnAccountView })
  async listAdminActionsOnAccount(
    @CurrentSession() session: { readonly record: { readonly accountId: string } } | null,
  ): Promise<AdminActionsOnAccountView> {
    if (!session) return { items: [] };
    const items = await this.list.execute(session.record.accountId);
    return {
      items: items.map((item) => ({
        action: item.action,
        at: item.at.toISOString(),
        reason: item.reason,
      })),
    };
  }
}
