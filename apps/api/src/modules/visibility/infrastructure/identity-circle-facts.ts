import { Injectable } from '@nestjs/common';
import { CircleReader } from '../../identity';
import { CircleFacts } from '../domain/ports';

/** Le cercle vient d'`identity`, seul juge (invariant 2) ; aucun cache. */
@Injectable()
export class IdentityCircleFacts extends CircleFacts {
  constructor(private readonly reader: CircleReader) {
    super();
  }

  membersOf(profileId: string): Promise<string[]> {
    return this.reader.membersOf(profileId);
  }

  inCircle(profileId: string, otherProfileId: string): Promise<boolean> {
    return this.reader.inCircle(profileId, otherProfileId);
  }
}
