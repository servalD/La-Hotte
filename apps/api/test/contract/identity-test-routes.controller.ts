import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  AccountScope,
  ActiveProfile,
  type ActiveProfileValue,
  ClientContext,
  type ClientContextValue,
  RequiresProfile,
  RequiresRecentReauth,
} from '../../src/modules/identity';

/**
 * Routes montées seulement par les tests de la chaîne de gardes (ADR 0013), en attendant les
 * routes réelles des tranches 2 à 5.
 */
@Controller('_identity-test')
export class IdentityTestRoutesController {
  @Get('profile')
  @RequiresProfile()
  profile(@ActiveProfile() profile: ActiveProfileValue): { profileId: string } {
    return { profileId: profile.id };
  }

  @Post('profile')
  @HttpCode(204)
  @RequiresProfile()
  mutateProfile(): void {}

  @Get('account')
  @AccountScope()
  account(): { ok: true } {
    return { ok: true };
  }

  @Post('reauth')
  @HttpCode(204)
  @AccountScope()
  @RequiresRecentReauth()
  reauth(): void {}

  @Get('client')
  @AccountScope()
  client(@ClientContext() client: ClientContextValue): { ip: string } {
    return { ip: client.ip };
  }
}
