import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ListSessions,
  type ResolvedSession,
  RevokeSession,
  sessionRef,
} from '../application/contract';
import { clearSessionCookies } from './cookies';
import { AccountScope, CurrentSession } from './decorators';
import { AccountSessionListView } from './dto/account-session.view';

/** Sessions du compte (AUTH-05), dans l'espace Compte : métadonnées seulement (PIN-08). */
@ApiTags('sessions')
@AccountScope()
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly listSessionsUseCase: ListSessions,
    private readonly revokeSessionUseCase: RevokeSession,
  ) {}

  @Get()
  @ApiOkResponse({ type: AccountSessionListView })
  async listSessions(@CurrentSession() current: ResolvedSession): Promise<AccountSessionListView> {
    const sessions = await this.listSessionsUseCase.execute(sessionRef(current.record));
    return {
      items: sessions.map((session) => ({
        id: session.id,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        current: session.current,
      })),
    };
  }

  /** `404` pour une session inconnue comme pour celle d'un autre compte (SEC-04). */
  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiNoContentResponse()
  async revokeSession(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() current: ResolvedSession,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const result = await this.revokeSessionUseCase.execute(sessionRef(current.record), id);
    if (result.current) clearSessionCookies(response);
  }
}
