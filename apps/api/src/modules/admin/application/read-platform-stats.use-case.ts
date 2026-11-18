import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/domain';
import {
  PlatformStatsReader,
  type PlatformStatsView,
  thresholdStats,
} from '../domain/platform-stats';

export type { PlatformStatsView } from '../domain/platform-stats';

/** STA-01, STA-02 : tableau de bord d'administration, agrégats seulement. */
@Injectable()
export class ReadPlatformStats {
  constructor(
    private readonly reader: PlatformStatsReader,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<PlatformStatsView> {
    return thresholdStats(await this.reader.read(this.clock.now()));
  }
}
