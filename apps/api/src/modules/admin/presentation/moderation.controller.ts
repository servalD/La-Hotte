import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ActiveProfile,
  type ActiveProfileValue,
  AdminScope,
  ClientContext,
  type ClientContextValue,
  CurrentPlatformActor,
  type PlatformActor,
  RequiresProfile,
  RestorePublication,
} from '../../identity';
import {
  ContestDecision,
  DecideContest,
  DecideModeration,
  ListDecisionsOnMyContent,
  type ProductUnderReview,
  type QueueEntry,
  ReadModerationQueue,
  ReportContent,
} from '../application/moderate-content.use-case';
import { CONTEST_WINDOW_MS, type OpenReports } from '../application/moderation.contract';
import { AdminReasonDto } from './dto/accounts.dto';
import {
  ContestDecisionDto,
  ContestDto,
  ModerationDecisionDto,
  ModerationTargetParams,
  ReportDto,
} from './dto/moderation.dto';
import {
  type CommentUnderReviewView,
  DecisionsOnMyContentView,
  ModerationQueueView,
  type OpenReportsView,
  type ProductUnderReviewView,
  type QueueEntryView,
} from './dto/moderation.view';

const UUID_PARAM = { schema: { type: 'string', format: 'uuid' } } as const;

const reportsView = (open: OpenReports | null): OpenReportsView | null =>
  open
    ? {
        reasons: open.reasons.map((r) => ({ reason: r.reason, count: r.count })),
        notes: [...open.notes],
        firstAt: open.firstAt.toISOString(),
      }
    : null;

const productView = (p: ProductUnderReview): ProductUnderReviewView => ({ ...p });

const commentView = (c: {
  id: string;
  thread: 'PUBLIC' | 'GIVERS';
  body: string;
  createdAt: Date;
}): CommentUnderReviewView => ({
  id: c.id,
  thread: c.thread,
  body: c.body,
  createdAt: c.createdAt.toISOString(),
});

function entryView(entry: QueueEntry): QueueEntryView {
  switch (entry.kind) {
    case 'PRODUCT':
      return {
        kind: 'PRODUCT',
        product: productView(entry.product),
        reports: reportsView(entry.reports),
      };
    case 'COMMENT':
      return {
        kind: 'COMMENT',
        comment: commentView(entry.comment),
        reports: reportsView(entry.reports),
      };
    case 'CONTEST':
      return {
        kind: 'CONTEST',
        contestId: entry.contestId,
        text: entry.text,
        decision: {
          action: entry.decision.action,
          reason: entry.decision.reason,
          at: entry.decision.at.toISOString(),
          targetKind: entry.decision.target.kind,
        },
        product: entry.product ? productView(entry.product) : null,
        comment: entry.comment ? commentView(entry.comment) : null,
      };
  }
}

/** MOD-07 : tout lecteur signale une fiche ou un message. */
@ApiTags('moderation')
@RequiresProfile()
@Controller('reports')
export class ReportsController {
  constructor(private readonly report: ReportContent) {}

  @Post()
  @HttpCode(204)
  @ApiNoContentResponse()
  async reportContent(
    @Body() body: ReportDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.report.execute({
      profileId: profile.id,
      accountId: profile.accountId,
      target: { kind: body.targetKind, id: body.targetId },
      reason: body.reason,
      note: body.note ?? null,
    });
  }
}

/** MOD-11 : l'auteur voit les décisions sur ses contenus et peut contester une fois. */
@ApiTags('moderation')
@RequiresProfile()
@Controller('moderation-decisions')
export class ModerationDecisionsController {
  constructor(
    private readonly list: ListDecisionsOnMyContent,
    private readonly contestDecision: ContestDecision,
  ) {}

  @Get()
  @ApiOkResponse({ type: DecisionsOnMyContentView })
  async listDecisionsOnMyContent(
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<DecisionsOnMyContentView> {
    const now = Date.now();
    const items = await this.list.execute(profile.id);
    return {
      items: items.map((d) => ({
        id: d.id,
        targetKind: d.target.kind,
        targetId: d.target.id,
        action: d.action,
        reason: d.reason,
        at: d.at.toISOString(),
        contested: d.contested,
        contestOutcome: d.contestOutcome,
        canContest: !d.contested && now - d.at.getTime() <= CONTEST_WINDOW_MS,
      })),
    };
  }

  @Post(':id/contest')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async contestModerationDecision(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ContestDto,
    @ActiveProfile() profile: ActiveProfileValue,
  ): Promise<void> {
    await this.contestDecision.execute({
      profileId: profile.id,
      accountId: profile.accountId,
      decisionId: id,
      text: body.text,
    });
  }
}

/** MOD-10, MOD-11 : file et décisions des modérateurs (ADM-05). */
@ApiTags('admin')
@Controller('admin/moderation')
export class AdminModerationController {
  constructor(
    private readonly queue: ReadModerationQueue,
    private readonly decide: DecideModeration,
    private readonly decideContest: DecideContest,
  ) {}

  @Get('queue')
  @AdminScope('moderation.queue')
  @ApiOkResponse({ type: ModerationQueueView })
  async getModerationQueue(
    @CurrentPlatformActor() actor: PlatformActor,
  ): Promise<ModerationQueueView> {
    return { items: (await this.queue.execute(actor.accountId)).map(entryView) };
  }

  @Post('contests/:id/decide')
  @AdminScope('moderation.decide')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async decideModerationContest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ContestDecisionDto,
    @CurrentPlatformActor() actor: PlatformActor,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.decideContest.execute({
      actorAccountId: actor.accountId,
      ip: client.ip,
      contestId: id,
      outcome: body.outcome,
      reason: body.reason,
    });
  }

  @Post(':kind/:id/decide')
  @AdminScope('moderation.decide')
  @HttpCode(204)
  @ApiParam({ name: 'kind', schema: { type: 'string', enum: ['products', 'comments'] } })
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async decideModeration(
    @Param() params: ModerationTargetParams,
    @Body() body: ModerationDecisionDto,
    @CurrentPlatformActor() actor: PlatformActor,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.decide.execute({
      actorAccountId: actor.accountId,
      ip: client.ip,
      target: { kind: params.kind === 'products' ? 'PRODUCT' : 'COMMENT', id: params.id },
      decision: body.decision,
      reason: body.reason,
    });
  }
}

/** MOD-10 : levée de la suspension de publication d'un compte. */
@ApiTags('admin')
@Controller('admin/accounts')
export class AdminPublicationController {
  constructor(private readonly restore: RestorePublication) {}

  @Post(':id/publication/restore')
  @AdminScope('moderation.decide')
  @HttpCode(204)
  @ApiParam({ name: 'id', ...UUID_PARAM })
  @ApiNoContentResponse()
  async restoreAccountPublication(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AdminReasonDto,
    @CurrentPlatformActor() actor: PlatformActor,
    @ClientContext() client: ClientContextValue,
  ): Promise<void> {
    await this.restore.execute({
      actorAccountId: actor.accountId,
      targetAccountId: id,
      reason: body.reason,
      ip: client.ip,
    });
  }
}
