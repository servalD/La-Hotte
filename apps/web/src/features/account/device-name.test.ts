import { deviceName } from './device-name';

// Les sessions et appareils de confiance s'affichent par un nom lisible, pas par l'agent brut.
describe('deviceName', () => {
  it('reconnaît les navigateurs et systèmes courants', () => {
    expect(
      deviceName(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      ),
    ).toBe('Chrome · Windows');
    expect(
      deviceName(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      ),
    ).toBe('Edge · Windows');
    expect(
      deviceName(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari · iOS');
    expect(
      deviceName('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'),
    ).toBe('Firefox · Linux');
  });

  it('un agent inconnu rend null (l’appelant affiche alors la valeur brute)', () => {
    expect(deviceName('curl/8.0')).toBeNull();
    expect(deviceName('')).toBeNull();
  });
});
