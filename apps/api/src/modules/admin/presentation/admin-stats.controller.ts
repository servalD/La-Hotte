import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { AdminScope } from '../../identity';
import { ReadPlatformStats } from '../application/read-platform-stats.use-case';

/** STA-02 : `null` quand l'agrégat porterait sur moins de 10 comptes (STA-01). */
export class PlatformStatsDto {
  @ApiProperty({ type: Number, nullable: true }) activeAccounts30d!: number | null;
  @ApiProperty({ type: Number, nullable: true }) accountsCreated30d!: number | null;
  @ApiProperty({ type: Number, nullable: true }) listsCreated30d!: number | null;
  @ApiProperty({ type: Number, nullable: true }) catalogProducts!: number | null;
  @ApiProperty({ type: Number, nullable: true }) openReports!: number | null;
  @ApiProperty({ type: Number, nullable: true }) medianReportHours!: number | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: 1 })
  extractionSuccessRate!: number | null;
}

/** STA-01, STA-02 : tableau de bord d'administration. */
@ApiTags('admin')
@Controller('admin/stats')
export class AdminStatsController {
  constructor(private readonly stats: ReadPlatformStats) {}

  @Get()
  @AdminScope('stats.read')
  @ApiOkResponse({ type: PlatformStatsDto })
  async getPlatformStats(): Promise<PlatformStatsDto> {
    return { ...(await this.stats.execute()) };
  }
}
