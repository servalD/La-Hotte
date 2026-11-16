import { isPublicAddress } from './address-policy.js';

// EXT-41, critère de 02 : adresses privées, de bouclage, lien-local, de métadonnées, réservées.

describe('isPublicAddress (EXT-41)', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // métadonnées cloud
    '100.64.0.1',
    '192.0.0.170',
    '192.0.2.10',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1', // IPv4 projetée
    '::ffff:169.254.169.254',
    '64:ff9b::7f00:1', // NAT64
    'fc00::1',
    'fd00:ec2::254', // métadonnées AWS en IPv6
    'fe80::1',
    'fe80::1%eth0',
    'fec0::1',
    'ff02::1',
    '2001::1', // Teredo
    '2001:db8::1',
    '2002:7f00:1::1', // 6to4 de 127.0.0.1
    '100::1',
    'localhost',
    '',
  ])('refuse %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    '93.184.215.14',
    '1.1.1.1',
    '8.8.8.8',
    '2606:4700:4700::1111',
    '2a00:1450:4007:80e::200e',
  ])('accepte %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});
