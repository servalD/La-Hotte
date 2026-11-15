import {
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_MERCHANT_MAX,
  PRODUCT_TITLE_MAX,
  PRODUCT_URL_MAX,
} from './product';

// Extraction d'une fiche (EXT-01 à EXT-35, ADR 0007, ADR 0016). Règles pures : normalisation,
// validation métier de ce que donnent les données structurées ou le modèle, complétude.

/** EXT-34 */
export const EXTRACTIONS_PER_PROFILE_PER_HOUR = 30;
export const EXTRACTIONS_PER_ACCOUNT_PER_DAY = 200;
/** EXT-34 : texte de page envoyé au modèle, après nettoyage (environ 5 000 jetons). */
export const PAGE_TEXT_MAX_CHARS = 20_000;
/** EXT-35 */
export const EXTRACTION_CACHE_TTL_MS = 24 * 3600_000;
/** EXT-06 */
export const STALE_EXTRACTION_MS = 2 * 60_000;
/** EXT-31 : un prix au-delà d'un million d'unités est tenu pour faux. */
const PLAUSIBLE_PRICE_UNITS_MAX = 1_000_000;

export type ExtractedField = 'title' | 'description' | 'price' | 'currency' | 'merchant' | 'image';

/** Ce qu'une source (données structurées, modèle) propose ; rien n'en est encore cru. */
export interface ExtractionCandidate {
  readonly title: string | null;
  readonly description: string | null;
  /** Montant décimal tel que lu (« 19,99 », « 1 299.00 ») : converti ici, jamais par le modèle. */
  readonly price: string | null;
  readonly currency: string | null;
  readonly merchant: string | null;
  readonly imageUrl: string | null;
  /** Champs dont la source doute. */
  readonly lowConfidence: readonly ExtractedField[];
}

export const EMPTY_CANDIDATE: ExtractionCandidate = {
  title: null,
  description: null,
  price: null,
  currency: null,
  merchant: null,
  imageUrl: null,
  lowConfidence: [],
};

/** Fiche validée (EXT-31) : chaque champ est sûr ou absent. */
export interface ValidatedExtraction {
  readonly title: string | null;
  readonly description: string | null;
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
  readonly merchant: string | null;
  readonly imageUrl: string | null;
  /** EXT-07 */
  readonly uncertainFields: readonly ExtractedField[];
}

const TRACKING_PARAMS = new Set([
  'gclid',
  'gclsrc',
  'dclid',
  'fbclid',
  'msclkid',
  'yclid',
  'ttclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'srsltid',
  '_ga',
  '_gl',
  'ref',
  'ref_',
  'referrer',
  'tag', // affiliation (EXT-02, question ouverte 2 de 02)
  'aff',
  'affid',
  'affiliate',
  'affiliate_id',
  'irclickid',
  'clickid',
  'spm',
  'scm',
  'cmpid',
  'campaign',
]);

/**
 * EXT-02, EXT-35 : URL normalisée (sert de clé de cache) : schéma et hôte en minuscules, port par
 * défaut, fragment, identifiants et paramètres de suivi ou d'affiliation retirés, paramètres triés.
 * `null` si ce n'est pas une adresse web.
 */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.username = '';
  url.password = '';
  const kept = [...url.searchParams.entries()]
    .filter(([key]) => {
      const lower = key.toLowerCase();
      return !lower.startsWith('utm_') && !TRACKING_PARAMS.has(lower);
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);
  const normalized = url.toString();
  return normalized.length <= PRODUCT_URL_MAX ? normalized : null;
}

/** Domaine d'une URL, seule partie qu'un journal peut porter (apps/api/CLAUDE.md, OBS-20). */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function currencyDigits(currency: string): number | null {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? null
    );
  } catch {
    return null;
  }
}

/** EXT-31 : devise ISO 4217 connue. */
export function isKnownCurrency(currency: string): boolean {
  if (!/^[A-Z]{3}$/.test(currency)) return false;
  try {
    return Intl.supportedValuesOf('currency').includes(currency);
  } catch {
    return currencyDigits(currency) !== null;
  }
}

/**
 * ART-11 : « 1 299,99 », « 1,299.99 », « 19.9 » → unités mineures entières, sans flottant. Le
 * dernier séparateur suivi de 1 à 3 chiffres (selon la devise) est la virgule décimale. `null` si
 * illisible.
 */
export function priceToMinor(raw: string, currency: string): number | null {
  if (!isKnownCurrency(currency)) return null;
  const digits = currencyDigits(currency);
  if (digits === null) return null;
  const compact = raw.replace(/[\s\u00a0\u202f']/g, '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(compact)) return null;
  const lastSeparator = Math.max(compact.lastIndexOf('.'), compact.lastIndexOf(','));
  let whole = compact;
  let fraction = '';
  if (lastSeparator >= 0) {
    const tail = compact.slice(lastSeparator + 1);
    // Trois chiffres après le dernier séparateur : des milliers, sauf pour une devise à trois décimales.
    const decimal =
      tail.length > 0 && tail.length <= Math.max(digits, 2) && (tail.length !== 3 || digits === 3);
    if (decimal) {
      whole = compact.slice(0, lastSeparator);
      fraction = tail;
    }
  }
  whole = whole.replace(/[.,]/g, '') || '0';
  if (!/^\d{1,12}$/.test(whole)) return null;
  if (fraction.length > digits) {
    if (/[1-9]/.test(fraction.slice(digits))) return null;
    fraction = fraction.slice(0, digits);
  }
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}
function clip(value: string | null, max: number): string | null {
  if (value === null) return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length === 0 ? null : clean.slice(0, max);
}

/**
 * EXT-31 : validation métier de ce que propose une source. Un champ invalide est retiré et compté
 * incertain ; jamais rien n'est « corrigé » à partir du contenu (prix à 0 refusé : une page piégée
 * ne fixe pas le prix).
 */
export function validateCandidate(candidate: ExtractionCandidate): ValidatedExtraction {
  const uncertain = new Set<ExtractedField>(candidate.lowConfidence);
  const title = clip(candidate.title, PRODUCT_TITLE_MAX);
  if (!title) uncertain.add('title');

  const currency = candidate.currency?.trim().toUpperCase() ?? null;
  const validCurrency = currency && isKnownCurrency(currency) ? currency : null;
  if (candidate.currency && !validCurrency) uncertain.add('currency');

  let unitPriceMinor: number | null = null;
  if (candidate.price !== null) {
    const minor = validCurrency ? priceToMinor(candidate.price, validCurrency) : null;
    const digits = validCurrency ? (currencyDigits(validCurrency) ?? 2) : 2;
    if (minor !== null && minor > 0 && minor <= PLAUSIBLE_PRICE_UNITS_MAX * 10 ** digits) {
      unitPriceMinor = minor;
    } else {
      uncertain.add('price');
    }
  }

  let imageUrl: string | null = null;
  if (candidate.imageUrl) {
    try {
      const url = new URL(candidate.imageUrl);
      if (url.protocol === 'https:' && candidate.imageUrl.length <= PRODUCT_URL_MAX) {
        imageUrl = url.toString();
      }
    } catch {
      // URL illisible
    }
    if (!imageUrl) uncertain.add('image');
  }

  return {
    title,
    description: clip(candidate.description, PRODUCT_DESCRIPTION_MAX),
    unitPriceMinor,
    currency: validCurrency,
    merchant: clip(candidate.merchant, PRODUCT_MERCHANT_MAX),
    imageUrl,
    uncertainFields: [...uncertain],
  };
}

/** ADR 0007, étape 3 : complète, on s'arrête là, sans modèle. */
export function isComplete(extraction: ValidatedExtraction): boolean {
  return (
    extraction.title !== null &&
    extraction.unitPriceMinor !== null &&
    extraction.currency !== null &&
    extraction.imageUrl !== null
  );
}

/** Données structurées d'abord (plus fiables), le modèle comble les manques. */
export function mergeCandidates(
  first: ExtractionCandidate,
  second: ExtractionCandidate,
): ExtractionCandidate {
  const pick = <K extends keyof Omit<ExtractionCandidate, 'lowConfidence'>>(key: K) =>
    first[key] ?? second[key];
  const fromSecond = (field: ExtractedField, key: keyof ExtractionCandidate) =>
    first[key] === null && second.lowConfidence.includes(field);
  const low = new Set<ExtractedField>(first.lowConfidence);
  const pairs: Array<[ExtractedField, keyof ExtractionCandidate]> = [
    ['title', 'title'],
    ['description', 'description'],
    ['price', 'price'],
    ['currency', 'currency'],
    ['merchant', 'merchant'],
    ['image', 'imageUrl'],
  ];
  for (const [field, key] of pairs) if (fromSecond(field, key)) low.add(field);
  return {
    title: pick('title'),
    description: pick('description'),
    price: first.price !== null ? first.price : second.price,
    currency: first.price !== null ? first.currency : (second.currency ?? first.currency),
    merchant: pick('merchant'),
    imageUrl: pick('imageUrl'),
    lowConfidence: [...low],
  };
}
