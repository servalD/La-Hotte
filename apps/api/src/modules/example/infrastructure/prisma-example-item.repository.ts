import { Injectable } from '@nestjs/common';
import {
  type ExampleItem as ExampleItemRow,
  ExamplePriority as PrismaPriority,
} from '@prisma/client';
import { PrismaService } from '../../../platform/prisma/prisma.service';
import { ExampleItem, type ExamplePriority } from '../domain/example-item';
import { ExampleItemRepository } from '../domain/example-item.repository';

const TO_DB: Record<ExamplePriority, PrismaPriority> = {
  low: PrismaPriority.LOW,
  normal: PrismaPriority.NORMAL,
  high: PrismaPriority.HIGH,
};
const FROM_DB: Record<PrismaPriority, ExamplePriority> = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
};

/** Mappeur : la ligne Prisma n'est jamais l'entité du domaine (ADR 0002). Aucune règle ici. */
export function toDomain(row: ExampleItemRow): ExampleItem {
  return ExampleItem.restore({
    id: row.id,
    title: row.title,
    priority: FROM_DB[row.priority],
    reservation:
      row.reservedByName !== null && row.reservedAt !== null
        ? { byName: row.reservedByName, at: row.reservedAt }
        : null,
    version: row.version,
    createdAt: row.createdAt,
  });
}

@Injectable()
export class PrismaExampleItemRepository extends ExampleItemRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string): Promise<ExampleItem | null> {
    const row = await this.prisma.exampleItem.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async save(item: ExampleItem): Promise<void> {
    const data = {
      title: item.title,
      priority: TO_DB[item.priority],
      reservedByName: item.reservation?.byName ?? null,
      reservedAt: item.reservation?.at ?? null,
      version: item.version,
    };
    await this.prisma.exampleItem.upsert({
      where: { id: item.id },
      create: { id: item.id, createdAt: item.createdAt, ...data },
      update: data,
    });
  }
}
