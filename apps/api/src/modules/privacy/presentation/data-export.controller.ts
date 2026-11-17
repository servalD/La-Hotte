import { Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ActiveProfile,
  type ActiveProfileValue,
  ClientContext,
  type ClientContextValue,
  RequiresProfile,
  RequiresRecentReauth,
} from '../../identity';
import {
  DownloadProfileData,
  ExportProfileData,
} from '../application/export-profile-data.use-case';

export class DataExportView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string;
}

/**
 * RGPD-04, RGPD-11 : export des données du profil actif (PIN validé), après ré-authentification,
 * jamais depuis l'espace Compte (PIN-08). Téléchargé une seule fois, dans les 24 heures.
 */
@ApiTags('profiles')
@RequiresProfile()
@Controller('profiles/me/export')
export class DataExportController {
  constructor(
    private readonly exportData: ExportProfileData,
    private readonly download: DownloadProfileData,
  ) {}

  @Post()
  @RequiresRecentReauth()
  @ApiCreatedResponse({ type: DataExportView })
  async requestProfileExport(
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
  ): Promise<DataExportView> {
    const created = await this.exportData.execute({ profile, client });
    return { id: created.id, expiresAt: created.expiresAt.toISOString() };
  }

  @Get(':id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiProduces('application/json')
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  async downloadProfileExport(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ActiveProfile() profile: ActiveProfileValue,
    @ClientContext() client: ClientContextValue,
    @Res() response: Response,
  ): Promise<void> {
    const payload = await this.download.execute({ profile, exportId: id, client });
    response
      .status(200)
      .setHeader('Cache-Control', 'no-store')
      .setHeader('X-Content-Type-Options', 'nosniff')
      .setHeader('Content-Disposition', 'attachment; filename="la-hotte-export.json"')
      .type('application/json')
      .send(payload);
  }
}
