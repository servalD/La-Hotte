import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  GetAccount,
  ListTrustedDevices,
  type ResolvedSession,
  RevokeTrustedDevice,
  sessionRef,
} from '../application/contract';
import { clearDeviceCookie, clearSessionCookies, DEVICE_COOKIE, readCookie } from './cookies';
import { AccountScope, ClientContext, type ClientContextValue, CurrentSession } from './decorators';
import { AccountView, TrustedDeviceListView } from './dto/second-factor.view';

/** Espace Compte (PIN-08) : métadonnées du compte seulement, jamais un contenu de profil. */
@ApiTags('account')
@AccountScope()
@Controller('account')
export class AccountController {
  constructor(private readonly getAccountUseCase: GetAccount) {}

  @Get()
  @ApiOkResponse({ type: AccountView })
  async getAccount(@CurrentSession() current: ResolvedSession): Promise<AccountView> {
    return this.getAccountUseCase.execute(current.record.accountId);
  }
}

/** Appareils de confiance (AUTH-12), dans l'espace Compte. */
@ApiTags('account')
@AccountScope()
@Controller('trusted-devices')
export class TrustedDevicesController {
  constructor(
    private readonly listUseCase: ListTrustedDevices,
    private readonly revokeUseCase: RevokeTrustedDevice,
  ) {}

  @Get()
  @ApiOkResponse({ type: TrustedDeviceListView })
  async listTrustedDevices(
    @CurrentSession() current: ResolvedSession,
    @Req() request: Request,
  ): Promise<TrustedDeviceListView> {
    const devices = await this.listUseCase.execute(
      current.record.accountId,
      readCookie(request, DEVICE_COOKIE),
    );
    return {
      items: devices.map((device) => ({
        id: device.id,
        userAgent: device.userAgent,
        createdAt: device.createdAt.toISOString(),
        expiresAt: device.expiresAt.toISOString(),
        current: device.current,
      })),
    };
  }

  /**
   * Révoque l'appareil et les sessions ouvertes grâce à lui. `404` pour un appareil inconnu comme
   * pour celui d'un autre compte (SEC-04).
   */
  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  async revokeTrustedDevice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
    @ClientContext() client: ClientContextValue,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const result = await this.revokeUseCase.execute({
      session: sessionRef(current.record),
      deviceId: id,
      client,
    });
    if (result.currentSessionRevoked) {
      clearSessionCookies(response);
      clearDeviceCookie(response);
    }
  }
}
