import { uuidv7 } from './uuid-v7';

describe('uuidv7', () => {
  it('produit un UUID de version 7, variante RFC 9562', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('est ordonné dans le temps', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
  });

  it('encode l’horodatage dans les 48 premiers bits', () => {
    const id = uuidv7(0x0123456789ab);
    expect(id.startsWith('01234567-89ab-7')).toBe(true);
  });
});
