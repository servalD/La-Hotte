import type { ListFacts } from '../domain/facts';
import { CircleFacts } from '../domain/ports';
import { VisibilityService } from './visibility.service';

// VIS-03, LNK-02 : le cercle est lu à chaque appel, et seulement quand il peut changer la réponse.

class FakeCircle extends CircleFacts {
  readonly pairs = new Set<string>();
  calls = 0;
  membersOf(profileId: string): Promise<string[]> {
    return Promise.resolve(
      [...this.pairs].filter((p) => p.startsWith(`${profileId}|`)).map((p) => p.split('|')[1]!),
    );
  }
  inCircle(a: string, b: string): Promise<boolean> {
    this.calls += 1;
    return Promise.resolve(this.pairs.has(`${a}|${b}`));
  }
  sameAccount(): Promise<boolean> {
    return Promise.resolve(false);
  }
  link(a: string, b: string): void {
    this.pairs.add(`${a}|${b}`).add(`${b}|${a}`);
  }
}

const wishlist: ListFacts = {
  id: 'l',
  type: 'WISHLIST',
  audience: 'CIRCLE',
  recipients: ['marie', 'paul'],
  members: [{ profileId: 'marie', role: 'CREATOR', since: new Date() }],
  customAudience: [],
  visibilityEditRole: 'CREATOR',
  giftExistence: 'HIDDEN',
  giftContent: 'NONE',
  personal: false,
  archived: false,
  deleted: false,
  event: null,
};

describe('VisibilityService (VIS-03)', () => {
  it('cercle d’un des destinataires : offreur ; lien rompu : plus rien à l’appel suivant', async () => {
    const circle = new FakeCircle();
    const service = new VisibilityService(circle);
    circle.link('paul', 'tonton');
    expect((await service.accessToList('tonton', wishlist)).kind).toBe('giver');
    circle.pairs.clear();
    expect((await service.accessToList('tonton', wishlist)).kind).toBe('none');
  });

  it('ne lit pas le cercle d’un membre, ni d’une audience qui n’est pas CERCLE', async () => {
    const circle = new FakeCircle();
    const service = new VisibilityService(circle);
    expect((await service.accessToList('marie', wishlist)).kind).toBe('recipient');
    expect((await service.accessToList('x', { ...wishlist, audience: 'MEMBERS' })).kind).toBe(
      'none',
    );
    expect(circle.calls).toBe(0);
  });

  it('candidats et cercle du demandeur', async () => {
    const circle = new FakeCircle();
    circle.link('marie', 'tonton');
    const service = new VisibilityService(circle);
    expect(await service.listCandidates('tonton')).toEqual({
      viewerId: 'tonton',
      circle: ['marie'],
    });
    expect(await service.circleOf('marie')).toEqual(['tonton']);
  });
});
