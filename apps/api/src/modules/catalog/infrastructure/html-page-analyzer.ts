import { Injectable } from '@nestjs/common';
import { type HTMLElement, parse } from 'node-html-parser';
import {
  EMPTY_CANDIDATE,
  type ExtractionCandidate,
  PAGE_TEXT_MAX_CHARS,
} from '../domain/extraction';
import { type PageAnalysis, PageAnalyzer } from '../domain/extraction.ports';

// EXT-02, étapes 3 et 4 : lecture d'une page marchande. Le HTML est une donnée non fiable
// (invariant 6) : on n'en exécute rien, on n'en rend rien ; on en lit des valeurs, ensuite validées
// par le domaine (EXT-31).

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function asObject(value: Json | undefined): Record<string, Json> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asText(value: Json | undefined): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  const object = asObject(value);
  if (object) return asText(object.name ?? object.url ?? object['@value']);
  if (Array.isArray(value)) return asText(value[0]);
  return null;
}

function typesOf(node: Record<string, Json>): string[] {
  const type = node['@type'];
  if (typeof type === 'string') return [type];
  return Array.isArray(type) ? type.filter((t): t is string => typeof t === 'string') : [];
}

/** Tous les objets d'un document JSON-LD (tableaux et `@graph` aplatis). */
function nodes(value: Json, out: Record<string, Json>[] = [], depth = 0): Record<string, Json>[] {
  if (depth > 6) return out;
  if (Array.isArray(value)) {
    for (const item of value) nodes(item, out, depth + 1);
    return out;
  }
  const object = asObject(value);
  if (!object) return out;
  out.push(object);
  if (object['@graph'] !== undefined) nodes(object['@graph'], out, depth + 1);
  return out;
}

function resolveUrl(raw: string | null, base: string): string | null {
  if (!raw) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

function fromJsonLd(root: HTMLElement, pageUrl: string): ExtractionCandidate {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed: Json;
    try {
      parsed = JSON.parse(script.textContent) as Json;
    } catch {
      continue;
    }
    const product = nodes(parsed).find((node) =>
      typesOf(node).some((type) => /(^|\/)Product$/.test(type)),
    );
    if (!product) continue;
    const offers = product.offers;
    const offer = asObject(Array.isArray(offers) ? offers[0] : offers);
    const spec = asObject(offer?.priceSpecification);
    const price = asText(offer?.price ?? offer?.lowPrice ?? spec?.price);
    const currency = asText(offer?.priceCurrency ?? spec?.priceCurrency);
    const image = product.image;
    return {
      title: asText(product.name),
      description: asText(product.description),
      price,
      currency,
      merchant: asText(asObject(offer?.seller)?.name ?? null),
      imageUrl: resolveUrl(asText(Array.isArray(image) ? image[0] : image), pageUrl),
      lowConfidence: [],
    };
  }
  return EMPTY_CANDIDATE;
}

function itemprop(scope: HTMLElement, name: string): string | null {
  const element = scope.querySelector(`[itemprop="${name}"]`);
  if (!element) return null;
  return (
    element.getAttribute('content') ??
    element.getAttribute('src') ??
    element.getAttribute('href') ??
    (element.textContent.trim() || null)
  );
}

function fromMicrodata(root: HTMLElement, pageUrl: string): ExtractionCandidate {
  const scope = root.querySelector('[itemtype*="schema.org/Product"]');
  if (!scope) return EMPTY_CANDIDATE;
  return {
    title: itemprop(scope, 'name'),
    description: itemprop(scope, 'description'),
    price: itemprop(scope, 'price'),
    currency: itemprop(scope, 'priceCurrency'),
    merchant: null,
    imageUrl: resolveUrl(itemprop(scope, 'image'), pageUrl),
    lowConfidence: [],
  };
}

function meta(root: HTMLElement, ...names: string[]): string | null {
  for (const name of names) {
    const element =
      root.querySelector(`meta[property="${name}"]`) ?? root.querySelector(`meta[name="${name}"]`);
    const content = element?.getAttribute('content')?.trim();
    if (content) return content;
  }
  return null;
}

function fromOpenGraph(root: HTMLElement, pageUrl: string): ExtractionCandidate {
  return {
    title: meta(root, 'og:title', 'twitter:title'),
    description: meta(root, 'og:description', 'description', 'twitter:description'),
    price: meta(root, 'product:price:amount', 'og:price:amount'),
    currency: meta(root, 'product:price:currency', 'og:price:currency'),
    merchant: meta(root, 'og:site_name'),
    imageUrl: resolveUrl(meta(root, 'og:image:secure_url', 'og:image', 'twitter:image'), pageUrl),
    lowConfidence: [],
  };
}

function firstOf(...candidates: ExtractionCandidate[]): ExtractionCandidate {
  const pick = <K extends keyof Omit<ExtractionCandidate, 'lowConfidence'>>(key: K) =>
    candidates.find((c) => c[key] !== null)?.[key] ?? null;
  // Prix et devise vont ensemble : de la même source.
  const priced = candidates.find((c) => c.price !== null);
  return {
    title: pick('title'),
    description: pick('description'),
    price: priced?.price ?? null,
    currency: priced?.currency ?? pick('currency'),
    merchant: pick('merchant'),
    imageUrl: pick('imageUrl'),
    lowConfidence: [],
  };
}

/** EXT-34 : texte visible, sans scripts, styles ni balisage, tronqué à une taille fixe. */
function visibleText(root: HTMLElement): { text: string; truncated: boolean } {
  for (const element of root.querySelectorAll(
    'script, style, noscript, template, svg, iframe, head',
  )) {
    element.remove();
  }
  const text = root.textContent.replace(/\s+/g, ' ').trim();
  if (text.length <= PAGE_TEXT_MAX_CHARS) return { text, truncated: false };
  return { text: text.slice(0, PAGE_TEXT_MAX_CHARS), truncated: true };
}

@Injectable()
export class HtmlPageAnalyzer extends PageAnalyzer {
  analyze(html: string, pageUrl: string): PageAnalysis {
    const root = parse(html, { comment: false, blockTextElements: { script: true, style: true } });
    const title = root.querySelector('title')?.textContent.trim() ?? null;
    const structured = firstOf(
      fromJsonLd(root, pageUrl),
      fromMicrodata(root, pageUrl),
      fromOpenGraph(root, pageUrl),
    );
    const body = visibleText(root);
    const text = title && !body.text.startsWith(title) ? `${title}\n${body.text}` : body.text;
    return {
      structured,
      text: text.slice(0, PAGE_TEXT_MAX_CHARS),
      truncated: body.truncated || text.length > PAGE_TEXT_MAX_CHARS,
    };
  }
}
