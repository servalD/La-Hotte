import { createHash } from 'node:crypto';
import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiHeader } from '@nestjs/swagger';
import type { Request } from 'express';
import { catchError, from, mergeMap, type Observable, of, switchMap, throwError } from 'rxjs';
import { activeProfileOf } from '../../modules/identity';
import { Clock, DomainError, IdGenerator } from '../../shared/domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * API-16, OFF-19, ADR 0020 : idempotence des actions qu'un client peut mettre en file hors ligne,
 * hors compta (qui tient la sienne dans sa transaction, CPT-71). Même table, mêmes 30 jours.
 */

export const IDEMPOTENT_OPERATION = 'platform:idempotent-operation';

/** Même forme de clé que la compta (CPT-71) : UUID conseillé. */
const KEY = /^[A-Za-z0-9_-]{8,128}$/;
export const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Une réservation plus vieille est reprise : l'exécution qui la tenait a échoué sans la rendre. */
export const IDEMPOTENCY_STALE_MS = 2 * 60 * 1000;

export class IdempotencyKeyRequiredError extends DomainError {
  readonly kind = 'business_rule';
  readonly code = 'IDEMPOTENCY_KEY_REQUIRED';
  constructor() {
    super('Idempotency-Key header is required.');
  }
}

export class IdempotencyKeyReusedError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  constructor() {
    super('Idempotency-Key was used for another request.');
  }
}

export class IdempotencyInProgressError extends DomainError {
  readonly kind = 'conflict';
  readonly code = 'IDEMPOTENCY_IN_PROGRESS';
  constructor() {
    super('A request with this Idempotency-Key is in progress.');
  }
}

/**
 * Marque une route dont la clé est exigée. `operation` distingue deux routes qui recevraient le
 * même corps (la clé vaut pour le profil, toutes routes confondues).
 */
export const Idempotent = (operation: string): MethodDecorator =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_OPERATION, operation),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description: 'API-16 : clé de 8 à 128 caractères [A-Za-z0-9_-], valable 30 jours.',
    }),
  );

export type IdempotencyBegin =
  | { readonly kind: 'run'; readonly id: string }
  | { readonly kind: 'replay'; readonly body: unknown };

/** Port de la plateforme : réservation, enregistrement, libération d'une clé. */
export abstract class IdempotencyStore {
  /** Réserve la clé, ou rend la réponse enregistrée ; lève `409` si elle sert à autre chose. */
  abstract begin(input: {
    readonly profileId: string;
    readonly key: string;
    readonly requestHash: string;
  }): Promise<IdempotencyBegin>;
  abstract complete(id: string, status: number, body: unknown): Promise<void>;
  /** L'exécution a échoué : la clé redevient libre (un nouvel essai exécute de nouveau). */
  abstract release(id: string): Promise<void>;
  /** Suite M4 de la revue de la phase 5 : clés échues effacées, compta comprise. */
  abstract purgeExpired(now: Date): Promise<number>;
}

interface StoredBody {
  readonly body: unknown;
}

@Injectable()
export class PrismaIdempotencyStore extends IdempotencyStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {
    super();
  }

  async begin(input: {
    profileId: string;
    key: string;
    requestHash: string;
  }): Promise<IdempotencyBegin> {
    const now = this.clock.now();
    const expires = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);
    const inserted = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "idempotency_record" ("id", "profile_id", "key", "request_hash", "status", "response", "expires_at", "created_at")
      VALUES (${this.ids.next()}::uuid, ${input.profileId}::uuid, ${input.key}, ${input.requestHash}, 0, '{}'::jsonb, ${expires}, ${now})
      ON CONFLICT ("profile_id", "key") DO NOTHING
      RETURNING "id"`;
    const created = inserted[0];
    if (created) return { kind: 'run', id: created.id };
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { profileId_key: { profileId: input.profileId, key: input.key } },
    });
    // Effacée entre-temps (libérée ou purgée) : un nouvel essai réservera.
    if (!existing) throw new IdempotencyInProgressError();
    const expired = existing.expiresAt.getTime() <= now.getTime();
    const stale =
      existing.status === 0 && existing.createdAt.getTime() <= now.getTime() - IDEMPOTENCY_STALE_MS;
    if (expired || (stale && existing.requestHash === input.requestHash)) {
      // Reprise conditionnelle : deux reprises simultanées, une seule gagne.
      const taken = await this.prisma.idempotencyRecord.updateMany({
        where: {
          id: existing.id,
          status: existing.status,
          createdAt: existing.createdAt,
        },
        data: {
          requestHash: input.requestHash,
          status: 0,
          response: {},
          expiresAt: expires,
          createdAt: now,
        },
      });
      if (taken.count === 1) return { kind: 'run', id: existing.id };
      throw new IdempotencyInProgressError();
    }
    if (existing.requestHash !== input.requestHash) throw new IdempotencyKeyReusedError();
    if (existing.status === 0) throw new IdempotencyInProgressError();
    return { kind: 'replay', body: (existing.response as unknown as StoredBody).body ?? null };
  }

  async complete(id: string, status: number, body: unknown): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { id },
      data: { status, response: JSON.parse(JSON.stringify({ body: body ?? null })) as object },
    });
  }

  async release(id: string): Promise<void> {
    await this.prisma.idempotencyRecord.deleteMany({ where: { id, status: 0 } });
  }

  async purgeExpired(now: Date): Promise<number> {
    const { count } = await this.prisma.idempotencyRecord.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return count;
  }
}

/** Double en mémoire, mêmes règles (tests de contrat). */
export class InMemoryIdempotencyStore extends IdempotencyStore {
  private readonly rows = new Map<
    string,
    {
      id: string;
      requestHash: string;
      status: number;
      body: unknown;
      createdAt: number;
      expiresAt: number;
    }
  >();
  private next = 0;

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  begin(input: { profileId: string; key: string; requestHash: string }): Promise<IdempotencyBegin> {
    const slot = `${input.profileId}:${input.key}`;
    const now = this.now();
    const existing = this.rows.get(slot);
    const fresh = () => {
      const id = `idem-${String(++this.next)}`;
      this.rows.set(slot, {
        id,
        requestHash: input.requestHash,
        status: 0,
        body: null,
        createdAt: now,
        expiresAt: now + IDEMPOTENCY_TTL_MS,
      });
      return Promise.resolve({ kind: 'run', id } as const);
    };
    if (!existing) return fresh();
    const expired = existing.expiresAt <= now;
    const stale = existing.status === 0 && existing.createdAt <= now - IDEMPOTENCY_STALE_MS;
    if (expired || (stale && existing.requestHash === input.requestHash)) return fresh();
    if (existing.requestHash !== input.requestHash) {
      return Promise.reject(new IdempotencyKeyReusedError());
    }
    if (existing.status === 0) return Promise.reject(new IdempotencyInProgressError());
    return Promise.resolve({ kind: 'replay', body: existing.body });
  }

  complete(id: string, status: number, body: unknown): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.id === id) {
        row.status = status;
        row.body = JSON.parse(JSON.stringify(body ?? null)) as unknown;
      }
    }
    return Promise.resolve();
  }

  release(id: string): Promise<void> {
    for (const [slot, row] of this.rows)
      if (row.id === id && row.status === 0) this.rows.delete(slot);
    return Promise.resolve();
  }

  purgeExpired(now: Date): Promise<number> {
    let count = 0;
    for (const [slot, row] of this.rows) {
      if (row.expiresAt <= now.getTime()) {
        this.rows.delete(slot);
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  /** Nombre d'entrées (tests). */
  get size(): number {
    return this.rows.size;
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** Empreinte d'une requête : opération, paramètres de chemin, `If-Match`, corps canonique. */
export function requestHashOf(
  operation: string,
  params: unknown,
  ifMatch: string | undefined,
  body: unknown,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        operation,
        canonical(params ?? {}),
        ifMatch ?? null,
        canonical(body ?? null),
      ]),
    )
    .digest('hex');
}

/**
 * Intercepteur global : ne fait rien sur une route sans `@Idempotent()`. Les gardes sont déjà
 * passées (profil actif déverrouillé) ; la validation du corps vient après, et une erreur de
 * validation libère la clé comme toute autre erreur.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyStore,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const operation = this.reflector.get<string | undefined>(
      IDEMPOTENT_OPERATION,
      context.getHandler(),
    );
    if (!operation || context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    const profile = activeProfileOf(request);
    if (!profile) return next.handle();
    const key = request.header('idempotency-key');
    if (key === undefined || !KEY.test(key)) {
      return throwError(() => new IdempotencyKeyRequiredError());
    }
    const requestHash = requestHashOf(
      operation,
      request.params,
      request.header('if-match'),
      request.body as unknown,
    );
    return from(this.store.begin({ profileId: profile.id, key, requestHash })).pipe(
      switchMap((begun) => {
        if (begun.kind === 'replay') return of(begun.body);
        const status = context.switchToHttp().getResponse<{ statusCode: number }>().statusCode;
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await this.store.complete(begun.id, status, body);
            return body;
          }),
          catchError((error: unknown) =>
            from(this.store.release(begun.id)).pipe(mergeMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }
}
