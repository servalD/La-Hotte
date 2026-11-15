import {
  EMPTY_CANDIDATE,
  isComplete,
  mergeCandidates,
  normalizeUrl,
  priceToMinor,
  validateCandidate,
} from './extraction';

// EXT-02, EXT-31, ART-11.

describe('normalizeUrl (EXT-02, EXT-35)', () => {
  it('retire suivi, affiliation, fragment et identifiants ; trie les paramètres', () => {
    expect(
      normalizeUrl('HTTPS://Shop.Example:443/velo?utm_source=x&b=2&gclid=y&a=1&tag=aff-21#avis'),
    ).toBe('https://shop.example/velo?a=1&b=2');
    expect(normalizeUrl('https://user:pw@shop.example/p')).toBe('https://shop.example/p');
  });

  it('refuse ce qui n’est pas une adresse web', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('ftp://shop.example/')).toBeNull();
    expect(normalizeUrl('pas une url')).toBeNull();
  });
});

describe('priceToMinor (ART-11, sans flottant)', () => {
  it.each<[string, string, number | null]>([
    ['19,99', 'EUR', 1999],
    ['19.99', 'EUR', 1999],
    ['19.9', 'EUR', 1990],
    ['1 299,00', 'EUR', 129900],
    ['1,299.00', 'USD', 129900],
    ['1.299', 'EUR', 129900], // milliers
    ['1299', 'JPY', 1299],
    ['1,299', 'JPY', 1299],
    ['12.500', 'KWD', 12500], // trois décimales
    ['0.1', 'EUR', 10],
    ['19.999', 'EUR', 1999900], // trois chiffres : des milliers
    ['abc', 'EUR', null],
    ['19,99', 'XXZ', null],
  ])('%s %s → %s', (raw, currency, expected) => {
    expect(priceToMinor(raw, currency)).toBe(expected);
  });

  it('3 × 19,99 € = 59,97 € (critère de 02)', () => {
    expect((priceToMinor('19,99', 'EUR') ?? 0) * 3).toBe(5997);
  });
});

describe('validateCandidate (EXT-31)', () => {
  it('page piégée : un prix à 0 est retiré, signalé incertain, jamais appliqué', () => {
    const v = validateCandidate({
      ...EMPTY_CANDIDATE,
      title: 'Vélo',
      price: '0',
      currency: 'EUR',
    });
    expect(v.unitPriceMinor).toBeNull();
    expect(v.uncertainFields).toContain('price');
  });

  it('devise inconnue, image non https, prix démesuré : retirés', () => {
    const v = validateCandidate({
      ...EMPTY_CANDIDATE,
      title: 'x',
      price: '9999999999',
      currency: 'ZZZ',
      imageUrl: 'http://shop.example/i.jpg',
    });
    expect(v).toMatchObject({ unitPriceMinor: null, currency: null, imageUrl: null });
    expect(new Set(v.uncertainFields)).toEqual(new Set(['price', 'currency', 'image']));
  });

  it('champs coupés aux longueurs de la fiche ; complète si titre, prix, devise et image', () => {
    const v = validateCandidate({
      ...EMPTY_CANDIDATE,
      title: `  ${'a'.repeat(300)}  `,
      price: '12,50',
      currency: 'eur',
      imageUrl: 'https://cdn.example/i.jpg',
    });
    expect(v.title).toHaveLength(200);
    expect(v).toMatchObject({ unitPriceMinor: 1250, currency: 'EUR' });
    expect(isComplete(v)).toBe(true);
    expect(isComplete({ ...v, imageUrl: null })).toBe(false);
  });
});

describe('mergeCandidates', () => {
  it('les données structurées l’emportent ; le modèle comble ; prix et devise vont ensemble', () => {
    const merged = mergeCandidates(
      { ...EMPTY_CANDIDATE, title: 'Structuré' },
      {
        ...EMPTY_CANDIDATE,
        title: 'Modèle',
        price: '10',
        currency: 'USD',
        merchant: 'Boutique',
        lowConfidence: ['merchant'],
      },
    );
    expect(merged).toMatchObject({
      title: 'Structuré',
      price: '10',
      currency: 'USD',
      merchant: 'Boutique',
    });
    expect(merged.lowConfidence).toEqual(['merchant']);
  });
});
