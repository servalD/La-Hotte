/**
 * Cercle d'un profil (LNK-09), lu par l'adaptateur à travers `identity` (seul juge du cercle).
 * Lu en base à chaque appel : un lien rompu retire l'accès à la requête suivante (LNK-02).
 */
export abstract class CircleFacts {
  abstract membersOf(profileId: string): Promise<string[]>;
  abstract inCircle(profileId: string, otherProfileId: string): Promise<boolean>;
}
