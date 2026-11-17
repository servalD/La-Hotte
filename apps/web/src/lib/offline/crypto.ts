// Chiffrement du cache d'un profil à PIN (OFF-21, OFF-26, ADR 0020) : AES-256-GCM, clé rendue par
// `GET /profiles/me/cache-key`, importée non extractible, jamais écrite nulle part.

export interface Sealed {
  readonly v: 1;
  readonly iv: Uint8Array;
  readonly data: ArrayBuffer;
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** `extractable: false` : la clé ne peut plus sortir de WebCrypto, même par le code de la page. */
export function importCacheKey(raw: string): Promise<CryptoKey> {
  const bytes = fromBase64Url(raw);
  if (bytes.length !== 32) throw new Error('Clé de cache invalide');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Données additionnelles : un enregistrement ne se déchiffre que sous son profil et son magasin. */
const aadOf = (profileId: string, store: string) => encoder.encode(`${profileId}|${store}`);

export async function seal(
  key: CryptoKey,
  profileId: string,
  store: string,
  value: unknown,
): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadOf(profileId, store) },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return { v: 1, iv, data };
}

export async function unseal<T>(
  key: CryptoKey,
  profileId: string,
  store: string,
  sealed: Sealed,
): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: sealed.iv as Uint8Array<ArrayBuffer>,
      additionalData: aadOf(profileId, store),
    },
    key,
    sealed.data,
  );
  return JSON.parse(decoder.decode(plain)) as T;
}

export function isSealed(value: unknown): value is Sealed {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { v?: unknown }).v === 1 &&
    (value as { iv?: unknown }).iv instanceof Uint8Array
  );
}
