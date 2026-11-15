import { ApiProperty } from '@nestjs/swagger';

const LINK_STATUSES = ['PENDING', 'AWAITING_GUARDIAN', 'ACCEPTED'] as const;
const LINK_ROLES = ['PARTY', 'GUARDIAN'] as const;
const CIRCLE_SOURCES = ['ACCOUNT', 'LINK'] as const;

/** LNK-09 : un membre du cercle. Le nom n'y est jamais celui d'un lien non accepté. */
export class CircleMemberView {
  @ApiProperty({ format: 'uuid' })
  profileId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  avatar!: string | null;

  @ApiProperty({ pattern: '^#[0-9a-f]{6}$' })
  accentColor!: string;

  @ApiProperty({ enum: CIRCLE_SOURCES })
  source!: (typeof CIRCLE_SOURCES)[number];
}

export class CircleView {
  @ApiProperty({ type: [CircleMemberView] })
  items!: CircleMemberView[];
}

export class LinkCounterpartView {
  @ApiProperty({ format: 'uuid' })
  profileId!: string;

  /** PRO-05 : absent tant que le lien n'est pas accepté, si l'autre partie est un enfant. */
  @ApiProperty({ type: String, nullable: true })
  displayName!: string | null;

  @ApiProperty({ pattern: '^#[0-9a-f]{6}$' })
  accentColor!: string;
}

export class LinkChildView {
  @ApiProperty({ format: 'uuid' })
  profileId!: string;

  @ApiProperty()
  displayName!: string;
}

/** LNK-06 : un lien, tel que le voit une partie ou le tuteur d'une partie enfant. */
export class LinkItemView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: LINK_STATUSES })
  status!: (typeof LINK_STATUSES)[number];

  @ApiProperty({ enum: LINK_ROLES })
  role!: (typeof LINK_ROLES)[number];

  @ApiProperty({ type: LinkCounterpartView })
  counterpart!: LinkCounterpartView;

  /** Pour un tuteur : l'enfant qu'il garde dans ce lien ; sinon `null`. */
  @ApiProperty({ type: LinkChildView, nullable: true })
  child!: LinkChildView | null;

  @ApiProperty()
  awaitingMyApproval!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class LinkListView {
  @ApiProperty({ type: [LinkItemView] })
  items!: LinkItemView[];
}

/** LNK-01 : le jeton n'est rendu qu'ici, une seule fois. */
export class CreatedInvitationView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'password' })
  token!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}

export class OpenInvitationView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['LINK', 'PROFILE'] })
  kind!: 'LINK' | 'PROFILE';

  /** PRO-11 : état de la proposition dans le compte visé ; `null` pour un lien. */
  @ApiProperty({ type: String, enum: ['PENDING', 'ACCEPTED', 'REFUSED'], nullable: true })
  proposal!: 'PENDING' | 'ACCEPTED' | 'REFUSED' | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}

export class InvitationListView {
  @ApiProperty({ type: [OpenInvitationView] })
  items!: OpenInvitationView[];
}

/** PRO-11 : proposition reçue par l'espace Compte (nom de l'invitant et marqueur seulement). */
export class ProfileProposalView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: 60 })
  inviterName!: string;

  @ApiProperty()
  profileIsChild!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}

export class ProfileProposalListView {
  @ApiProperty({ type: [ProfileProposalView] })
  items!: ProfileProposalView[];
}

/** PRO-11 : ce que voit la personne invitée à créer un profil. */
export class ProfileInvitationPreviewView {
  @ApiProperty({ maxLength: 60 })
  inviterName!: string;

  @ApiProperty()
  profileIsChild!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}

/** LNK-07 : ce que voit celui qui ouvre un lien. */
export class InvitationPreviewView {
  /** Absent si l'invitant est un enfant. */
  @ApiProperty({ type: String, nullable: true })
  inviterName!: string | null;

  @ApiProperty({ pattern: '^#[0-9a-f]{6}$' })
  inviterAccentColor!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}

export class RedeemedInvitationView {
  @ApiProperty({ format: 'uuid' })
  linkId!: string;

  @ApiProperty({ enum: LINK_STATUSES })
  status!: (typeof LINK_STATUSES)[number];
}

export class BlockedProfileView {
  @ApiProperty({ format: 'uuid' })
  profileId!: string;

  /** PRO-05 : absent pour un enfant. */
  @ApiProperty({ type: String, nullable: true })
  displayName!: string | null;

  @ApiProperty({ pattern: '^#[0-9a-f]{6}$' })
  accentColor!: string;
}

export class BlockListView {
  @ApiProperty({ type: [BlockedProfileView] })
  items!: BlockedProfileView[];
}
