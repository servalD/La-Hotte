import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { AesGcmKeyring } from '../../../platform/crypto/aes-gcm';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { DataExportStore } from '../domain/data-export';

/** SEC-22 : le fichier est lié à sa demande et à son profil (données authentifiées). */
const contextOf = (id: string, profileId: string): string => `export|${id}|${profileId}`;

/** RGPD-11 : fichiers chiffrés en base, rendus une fois puis effacés. */
@Injectable()
export class PrismaDataExportStore extends DataExportStore {
  private readonly keyring: AesGcmKeyring;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfig,
  ) {
    super();
    this.keyring = new AesGcmKeyring(config.env.SECRET_ENCRYPTION_KEYS);
  }

  async lastRequestedAt(profileId: string): Promise<Date | null> {
    const row = await this.prisma.exportRequest.findFirst({
      where: { profileId },
      orderBy: { requestedAt: 'desc' },
      select: { requestedAt: true },
    });
    return row?.requestedAt ?? null;
  }

  async create(input: {
    id: string;
    profileId: string;
    requestedAt: Date;
    expiresAt: Date;
    payload: string;
  }): Promise<void> {
    await this.prisma.exportRequest.create({
      data: {
        id: input.id,
        profileId: input.profileId,
        requestedAt: input.requestedAt,
        expiresAt: input.expiresAt,
        readyAt: input.requestedAt,
        payloadEnc: new Uint8Array(
          this.keyring.encrypt(input.payload, contextOf(input.id, input.profileId)),
        ),
      },
    });
  }

  take(input: { id: string; profileId: string; now: Date }): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ payload_enc: Uint8Array | null }[]>`
        SELECT "payload_enc" FROM "export_request"
        WHERE "id" = ${input.id}::uuid AND "profile_id" = ${input.profileId}::uuid
          AND "downloaded_at" IS NULL AND "expires_at" > ${input.now}
          AND "payload_enc" IS NOT NULL
        FOR UPDATE`;
      if (!row?.payload_enc) return null;
      await tx.exportRequest.update({
        where: { id: input.id },
        data: { downloadedAt: input.now, payloadEnc: null },
      });
      return this.keyring.decrypt(row.payload_enc, contextOf(input.id, input.profileId));
    });
  }

  async purge(now: Date): Promise<number> {
    const { count } = await this.prisma.exportRequest.updateMany({
      where: { expiresAt: { lte: now }, payloadEnc: { not: null } },
      data: { payloadEnc: null },
    });
    return count;
  }
}

/** Double des tests : texte gardé tel quel, mêmes règles d'accès. */
export class InMemoryDataExportStore extends DataExportStore {
  readonly rows = new Map<
    string,
    {
      profileId: string;
      requestedAt: Date;
      expiresAt: Date;
      payload: string | null;
      downloadedAt: Date | null;
    }
  >();

  lastRequestedAt(profileId: string): Promise<Date | null> {
    const dates = [...this.rows.values()]
      .filter((r) => r.profileId === profileId)
      .map((r) => r.requestedAt.getTime());
    return Promise.resolve(dates.length ? new Date(Math.max(...dates)) : null);
  }

  create(input: {
    id: string;
    profileId: string;
    requestedAt: Date;
    expiresAt: Date;
    payload: string;
  }): Promise<void> {
    this.rows.set(input.id, { ...input, downloadedAt: null });
    return Promise.resolve();
  }

  take(input: { id: string; profileId: string; now: Date }): Promise<string | null> {
    const row = this.rows.get(input.id);
    if (
      !row ||
      row.profileId !== input.profileId ||
      row.downloadedAt ||
      row.expiresAt <= input.now ||
      row.payload === null
    ) {
      return Promise.resolve(null);
    }
    const payload = row.payload;
    row.payload = null;
    row.downloadedAt = input.now;
    return Promise.resolve(payload);
  }

  purge(now: Date): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.expiresAt <= now && row.payload !== null) {
        row.payload = null;
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
}
