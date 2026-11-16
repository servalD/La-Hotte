import {
  addOneYear,
  endOfDay,
  isDayPassed,
  isDayTodayOrLater,
  isDoneDue,
  isValidDay,
  isValidTimezone,
  localDay,
} from './event-date';

// EVT-05, EVT-16, EVT-33, EVT-40 : jour et fuseau (ADR 0017).

describe('Date d’un événement (EVT-05)', () => {
  it('jour calendaire valide seulement', () => {
    expect(isValidDay('2027-12-24')).toBe(true);
    expect(isValidDay('2027-02-29')).toBe(false);
    expect(isValidDay('2028-02-29')).toBe(true);
    expect(isValidDay('24/12/2027')).toBe(false);
  });

  it('fuseau IANA', () => {
    expect(isValidTimezone('Europe/Paris')).toBe(true);
    expect(isValidTimezone('Pas/Un_Fuseau')).toBe(false);
  });

  it('le jour local dépend du fuseau', () => {
    const instant = new Date('2027-12-24T03:00:00Z');
    expect(localDay(instant, 'Europe/Paris')).toBe('2027-12-24');
    expect(localDay(instant, 'America/Los_Angeles')).toBe('2027-12-23');
  });

  it('passé seulement après la fin du jour local', () => {
    expect(isDayPassed('2027-12-24', 'Europe/Paris', new Date('2027-12-24T22:59:00Z'))).toBe(false);
    expect(isDayPassed('2027-12-24', 'Europe/Paris', new Date('2027-12-24T23:00:00Z'))).toBe(true);
    expect(isDayTodayOrLater('2027-12-24', 'Europe/Paris', new Date('2027-12-24T12:00:00Z'))).toBe(
      true,
    );
  });

  it('EVT-16 : fin du jour à minuit local, heure d’hiver et d’été', () => {
    expect(endOfDay('2027-12-24', 'Europe/Paris').toISOString()).toBe('2027-12-24T23:00:00.000Z');
    expect(endOfDay('2027-07-14', 'Europe/Paris').toISOString()).toBe('2027-07-14T22:00:00.000Z');
    expect(endOfDay('2027-12-24', 'America/New_York').toISOString()).toBe(
      '2027-12-25T05:00:00.000Z',
    );
  });

  it('EVT-33 : terminé 30 jours après la date', () => {
    expect(isDoneDue('2027-12-24', 'Europe/Paris', new Date('2028-01-23T12:00:00Z'))).toBe(false);
    expect(isDoneDue('2027-12-24', 'Europe/Paris', new Date('2028-01-24T12:00:00Z'))).toBe(true);
  });

  it('EVT-40 : un an plus tard, le 29 février devient le 28', () => {
    expect(addOneYear('2027-12-24')).toBe('2028-12-24');
    expect(addOneYear('2028-02-29')).toBe('2029-02-28');
  });
});
