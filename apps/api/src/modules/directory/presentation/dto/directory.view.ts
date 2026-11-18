import { ApiProperty } from '@nestjs/swagger';

/** REP-01, REP-03 : une fiche partagée, avec qui la partage ; rien de la liste où elle figure. */
export class DirectoryEntryView {
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: String, nullable: true }) imageKey!: string | null;
  @ApiProperty({ type: Number, nullable: true }) unitPriceMinor!: number | null;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: String, nullable: true }) merchant!: string | null;
  @ApiProperty({ type: String, nullable: true }) sourceUrl!: string | null;
  /** REP-03 : profil du cercle qui partage (son nom se lit par `GET /circle`). */
  @ApiProperty({ format: 'uuid' }) sharedBy!: string;
}

export class DirectoryView {
  @ApiProperty({ type: [DirectoryEntryView] }) items!: DirectoryEntryView[];
}

/**
 * REP-04, MOD-05, MOD-12 : une fiche du catalogue global, **sans auteur**, sans note, sans photo de
 * l'utilisateur ; `adopters` compte des comptes, jamais des noms.
 */
export class GlobalCatalogEntryView {
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: String, nullable: true }) imageKey!: string | null;
  @ApiProperty({ type: Number, nullable: true }) unitPriceMinor!: number | null;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: String, nullable: true }) merchant!: string | null;
  @ApiProperty({ type: String, nullable: true }) sourceUrl!: string | null;
  @ApiProperty() adopters!: number;
}

export class GlobalCatalogView {
  @ApiProperty({ type: [GlobalCatalogEntryView] }) items!: GlobalCatalogEntryView[];
}

export class SharedProductView {
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty({ enum: ['PRIVATE', 'CIRCLE', 'GLOBAL'], enumName: 'ShareLevel' })
  shareLevel!: 'PRIVATE' | 'CIRCLE' | 'GLOBAL';
  @ApiProperty() version!: number;
}

export class CopiedDirectoryProductView {
  @ApiProperty({ format: 'uuid' }) productId!: string;
}
