import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { VisibilityService } from './application/visibility.service';
import { CircleFacts } from './domain/ports';
import { IdentityCircleFacts } from './infrastructure/identity-circle-facts';

/** Moteur de visibilité (ADR 0004, ADR 0016) : seul juge de ce qu'un profil voit. */
@Module({
  imports: [IdentityModule],
  providers: [VisibilityService, { provide: CircleFacts, useClass: IdentityCircleFacts }],
  exports: [VisibilityService],
})
export class VisibilityModule {}
