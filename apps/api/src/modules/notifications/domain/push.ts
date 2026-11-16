import type { NotificationCategory, NotificationRecord } from './notification';

// Web Push (NOT-06, NOT-07, NOT-15, NOT-16 ; ADR 0018).

/** NOT-15 : appareils par profil. */
export const PUSH_DEVICES_PER_PROFILE = 10;

/**
 * NOT-16 : services de push connus, en liste fermée. Le serveur appelle l'URL fournie par le
 * client : toute autre adresse serait une SSRF.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

/** NOT-16 : `https`, port par défaut, hôte connu, sans identifiants ni fragment. */
export function pushEndpointAllowed(endpoint: string): boolean {
  if (endpoint.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password || url.hash) {
    return false;
  }
  return PUSH_HOSTS.some((host) => host.test(url.hostname));
}

/** Clés d'un abonnement (RFC 8291) : base64url. */
export function pushKeysWellFormed(keys: { p256dh: string; auth: string }): boolean {
  return /^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh) && /^[A-Za-z0-9_-]{16,32}$/.test(keys.auth);
}

export interface PushDevice {
  readonly subscriptionId: string;
  readonly sessionId: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly showDetails: boolean;
}

export interface PushPayload {
  readonly title: string;
  readonly body: string;
  /** Regroupe les push d'un même profil sur l'appareil. */
  readonly tag: string;
  readonly url: string;
}

/** NOT-06 : texte sans détail, par catégorie ; un fil Offreurs dit seulement « un cadeau ». */
function neutralBody(notification: NotificationRecord): string {
  const givers = notification.subject.kind === 'item' && notification.subject.thread === 'GIVERS';
  const byCategory: Record<NotificationCategory, string> = {
    INVITATIONS: 'Une nouvelle invitation vous attend',
    LINKS: 'Une demande de lien vous attend',
    COMMENTS: givers ? 'Du nouveau sur un cadeau que vous préparez' : 'Un nouveau message',
    MENTIONS: givers
      ? 'Du nouveau sur un cadeau que vous préparez'
      : 'On vous a cité dans un message',
    GIFTS: 'Du nouveau sur un cadeau que vous préparez',
    ITEMS: 'Du nouveau sur un cadeau que vous préparez',
    EVENTS: 'Du nouveau pour un événement',
    EXTRACTION: 'Votre fiche est prête',
    SECURITY: 'Alerte de sécurité sur votre compte',
  };
  return byCategory[notification.category];
}

/**
 * NOT-06, NOT-07 : la push nomme le profil auquel elle s'adresse ; le détail (titre relu par le
 * moteur) n'apparaît que si le profil l'a demandé sur cet appareil.
 */
export function pushPayload(input: {
  readonly notification: NotificationRecord;
  readonly profileName: string;
  readonly showDetails: boolean;
  readonly detail: string | null;
}): PushPayload {
  const neutral = neutralBody(input.notification);
  return {
    title: `Pour ${input.profileName}`,
    body: input.showDetails && input.detail ? `${neutral} : ${input.detail}` : neutral,
    tag: `profile-${input.notification.profileId}`,
    url: '/notifications',
  };
}
