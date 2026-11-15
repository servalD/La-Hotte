import { BlockList, isIPv4, isIPv6 } from 'node:net';

// EXT-41 : seules les adresses publiques de l'Internet sont joignables. Liste blanche pour IPv6
// (unicast global 2000::/3 seulement), liste noire des plages réservées pour IPv4 et à l'intérieur
// de 2000::/3. Une adresse IPv6 qui embarque une adresse IPv4 (::ffff:a.b.c.d, NAT64, 6to4,
// Teredo) est refusée : on ne la déballe pas, on ne s'y connecte jamais.

const IPV4_BLOCKED: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8], // « ce réseau »
  ['10.0.0.0', 8], // privé
  ['100.64.0.0', 10], // NAT partagé (CGNAT)
  ['127.0.0.0', 8], // bouclage
  ['169.254.0.0', 16], // lien-local, métadonnées cloud (169.254.169.254)
  ['172.16.0.0', 12], // privé
  ['192.0.0.0', 24], // IETF
  ['192.0.2.0', 24], // documentation
  ['192.31.196.0', 24], // AS112
  ['192.52.193.0', 24], // AMT
  ['192.88.99.0', 24], // relais 6to4
  ['192.168.0.0', 16], // privé
  ['192.175.48.0', 24], // AS112
  ['198.18.0.0', 15], // tests de performance
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multidiffusion
  ['240.0.0.0', 4], // réservé, et 255.255.255.255
];

const IPV6_ALLOWED = new BlockList();
IPV6_ALLOWED.addSubnet('2000::', 3, 'ipv6');

const IPV6_BLOCKED_IN_GLOBAL: ReadonlyArray<[string, number]> = [
  ['2001::', 23], // IETF (Teredo 2001::/32, ORCHID, documentation de protocole…)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embarque une IPv4)
  ['3fff::', 20], // documentation
];

const blocked4 = new BlockList();
for (const [network, prefix] of IPV4_BLOCKED) blocked4.addSubnet(network, prefix, 'ipv4');
const blocked6 = new BlockList();
for (const [network, prefix] of IPV6_BLOCKED_IN_GLOBAL) blocked6.addSubnet(network, prefix, 'ipv6');

/** Vrai si l'on peut se connecter à cette adresse IP littérale (EXT-41). */
export function isPublicAddress(address: string): boolean {
  if (isIPv4(address)) return !blocked4.check(address, 'ipv4');
  if (isIPv6(address)) {
    // Zone (fe80::1%eth0) : lien-local par construction.
    if (address.includes('%')) return false;
    return IPV6_ALLOWED.check(address, 'ipv6') && !blocked6.check(address, 'ipv6');
  }
  return false;
}
