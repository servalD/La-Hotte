import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator, Metrics } from '../../../shared/domain';
import {
  EXTRACTION_CACHE_TTL_MS,
  EXTRACTIONS_PER_ACCOUNT_PER_DAY,
  EXTRACTIONS_PER_PROFILE_PER_HOUR,
  type ExtractedField,
  hostnameOf,
  isComplete,
  mergeCandidates,
  normalizeUrl,
  STALE_EXTRACTION_MS,
  type ValidatedExtraction,
  validateCandidate,
} from '../domain/extraction';
import {
  ExtractionRateLimitedError,
  FetcherUnavailableError,
  ImageRejectedError,
  ProductUrlInvalidError,
} from '../domain/extraction.errors';
import {
  ExtractionCache,
  ExtractionQueue,
  type ModelOutcome,
  PageAnalyzer,
  ProductExtractor,
} from '../domain/extraction.ports';
import { PageFetcher } from '../domain/page-fetcher.port';
import type { Product } from '../domain/product';
import { ImageStore, ProductRepository } from '../domain/product.ports';

/** EXT-34 : refus avant toute création si le profil ou son compte a atteint son plafond. */
async function checkRateLimit(
  products: ProductRepository,
  clock: Clock,
  owner: { readonly profileId: string; readonly accountId: string },
): Promise<void> {
  const now = clock.now().getTime();
  const counts = await products.countExtractionsSince({
    ...owner,
    profileSince: new Date(now - 3600_000),
    accountSince: new Date(now - 24 * 3600_000),
  });
  if (
    counts.profile >= EXTRACTIONS_PER_PROFILE_PER_HOUR ||
    counts.account >= EXTRACTIONS_PER_ACCOUNT_PER_DAY
  ) {
    throw new ExtractionRateLimitedError();
  }
}

/**
 * EXT-01, EXT-04, EXT-06 : `POST /products` avec un lien. La fiche brouillon naît aussitôt en
 * `PENDING`, sous le nom du site en attendant mieux ; l'extraction suit dans la file.
 */
@Injectable()
export class CreateProductFromLink {
  constructor(
    private readonly products: ProductRepository,
    private readonly queue: ExtractionQueue,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    ownerProfileId: string;
    accountId: string;
    url: string;
    currency: string;
  }): Promise<Product> {
    const normalized = normalizeUrl(input.url);
    if (!normalized) throw new ProductUrlInvalidError();
    await checkRateLimit(this.products, this.clock, {
      profileId: input.ownerProfileId,
      accountId: input.accountId,
    });
    const product = await this.products.create({
      id: this.ids.next(),
      ownerProfileId: input.ownerProfileId,
      title: hostnameOf(normalized) || 'Lien',
      description: '',
      unitPriceMinor: null,
      currency: input.currency,
      merchant: null,
      // EXT-05 : le lien est gardé quoi qu'il arrive.
      sourceUrl: normalized,
      normalizedUrl: normalized,
      source: 'LINK',
      imageKey: null,
      imageFromPhoto: false,
      extractionStatus: 'PENDING',
      extractionStartedAt: this.clock.now(),
    });
    this.queue.enqueue({ kind: 'link', productId: product.id, url: normalized });
    return product;
  }
}

/** EXT-10, EXT-11, EXT-46 : photo réencodée par le fetcher (métadonnées retirées), puis extraction. */
@Injectable()
export class CreateProductFromPhoto {
  constructor(
    private readonly products: ProductRepository,
    private readonly fetcher: PageFetcher,
    private readonly images: ImageStore,
    private readonly queue: ExtractionQueue,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    ownerProfileId: string;
    accountId: string;
    photo: Buffer;
    currency: string;
  }): Promise<Product> {
    await checkRateLimit(this.products, this.clock, {
      profileId: input.ownerProfileId,
      accountId: input.accountId,
    });
    const image = await this.fetcher.reencode(input.photo);
    if (!image.ok) {
      if (image.failure === 'UNAVAILABLE') throw new FetcherUnavailableError();
      throw new ImageRejectedError();
    }
    const imageKey = await this.images.put(image.bytes, image.contentType);
    const product = await this.products.create({
      id: this.ids.next(),
      ownerProfileId: input.ownerProfileId,
      title: 'Photo',
      description: '',
      unitPriceMinor: null,
      currency: input.currency,
      merchant: null,
      sourceUrl: null,
      normalizedUrl: null,
      source: 'PHOTO',
      // EXT-10 : la photo sert d'illustration ; jamais publiée au catalogue global (REP-04).
      imageKey,
      imageFromPhoto: true,
      extractionStatus: 'PENDING',
      extractionStartedAt: this.clock.now(),
    });
    this.queue.enqueue({ kind: 'photo', productId: product.id, imageKey });
    return product;
  }
}

/**
 * La chaîne de EXT-02, exécutée par la file : cache, récupération par le fetcher, données
 * structurées, modèle s'il manque quelque chose, validation, image, brouillon. Tout échec laisse un
 * brouillon modifiable avec son lien (EXT-05). Les journaux et métriques ne portent que des codes.
 */
@Injectable()
export class RunExtraction {
  constructor(
    private readonly products: ProductRepository,
    private readonly fetcher: PageFetcher,
    private readonly analyzer: PageAnalyzer,
    private readonly extractor: ProductExtractor,
    private readonly cache: ExtractionCache,
    private readonly images: ImageStore,
    private readonly metrics: Metrics,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async link(productId: string, url: string): Promise<void> {
    const now = this.clock.now();
    const cached = await this.cache.get(url, now);
    if (cached) {
      this.metrics.increment('wishlist.extraction_outcome', { code: 'CACHE' });
      // EXT-35 (revue SEC-40, M1) : l'image est recopiée sous une clé neuve ; la clé d'un autre
      // profil trahirait qu'il a ajouté le même lien.
      const image = cached.imageKey ? await this.images.get(cached.imageKey) : null;
      const imageKey = image ? await this.images.put(image.bytes, image.contentType) : null;
      await this.complete(productId, cached.extraction, imageKey, cached.truncated);
      return;
    }
    const page = await this.fetcher.fetchPage(url);
    if (!page.ok) {
      this.metrics.increment('wishlist.extraction_outcome', { code: page.failure });
      await this.fail(productId);
      return;
    }
    const analysis = this.analyzer.analyze(page.html, page.finalUrl);
    let candidate = analysis.structured;
    let validated = validateCandidate(candidate);
    let usedModel = false;
    if (!isComplete(validated) && analysis.text.length > 0) {
      const outcome = await this.extractor.fromPageText(analysis.text);
      this.recordModel(outcome);
      if (outcome.status === 'ok') {
        usedModel = true;
        candidate = mergeCandidates(candidate, outcome.candidate);
        validated = validateCandidate(candidate);
      }
    }
    if (validated.title === null) {
      this.metrics.increment('wishlist.extraction_outcome', { code: 'NOTHING_FOUND' });
      await this.fail(productId);
      return;
    }
    const imageKey = await this.storeImage(validated);
    this.metrics.increment('wishlist.extraction_outcome', {
      code: usedModel ? 'MODEL' : 'STRUCTURED',
    });
    // EXT-35 : seules les données publiques de la page vont au cache.
    await this.cache.put({
      id: this.ids.next(),
      normalizedUrl: url,
      value: { extraction: validated, imageKey, truncated: analysis.truncated },
      expiresAt: new Date(now.getTime() + EXTRACTION_CACHE_TTL_MS),
    });
    await this.complete(productId, validated, imageKey, usedModel && analysis.truncated);
  }

  async photo(productId: string, imageKey: string): Promise<void> {
    const image = await this.images.get(imageKey);
    if (!image) {
      await this.fail(productId);
      return;
    }
    const outcome = await this.extractor.fromPhoto(image.bytes);
    this.recordModel(outcome);
    if (outcome.status !== 'ok') {
      await this.fail(productId);
      return;
    }
    const validated = validateCandidate({ ...outcome.candidate, imageUrl: null });
    if (validated.title === null) {
      await this.fail(productId);
      return;
    }
    this.metrics.increment('wishlist.extraction_outcome', { code: 'PHOTO' });
    await this.complete(
      productId,
      { ...validated, uncertainFields: validated.uncertainFields.filter((f) => f !== 'image') },
      null,
      false,
    );
  }

  private recordModel(outcome: ModelOutcome): void {
    if (outcome.status === 'unavailable') {
      this.metrics.increment('wishlist.extraction_outcome', { code: 'MODEL_UNAVAILABLE' });
      return;
    }
    // Tâche 8 de la phase 0 bis : coût de l'extraction, en jetons (jamais un montant de part).
    this.metrics.record('wishlist.extraction_tokens', outcome.usage.inputTokens, { code: 'INPUT' });
    this.metrics.record('wishlist.extraction_tokens', outcome.usage.outputTokens, {
      code: 'OUTPUT',
    });
    if (outcome.status !== 'ok') {
      this.metrics.increment('wishlist.extraction_outcome', {
        code: outcome.status === 'refused' ? 'MODEL_REFUSED' : 'MODEL_INVALID',
      });
    }
  }

  /** EXT-03, EXT-45 : téléchargée et réencodée par le fetcher ; un échec n'empêche pas la fiche. */
  private async storeImage(validated: ValidatedExtraction): Promise<string | null> {
    if (!validated.imageUrl) return null;
    const image = await this.fetcher.fetchImage(validated.imageUrl);
    if (!image.ok) return null;
    return this.images.put(image.bytes, image.contentType);
  }

  private async complete(
    productId: string,
    validated: ValidatedExtraction,
    imageKey: string | null,
    truncated: boolean,
  ): Promise<void> {
    const uncertain = new Set<ExtractedField>(validated.uncertainFields);
    if (imageKey === null && validated.imageUrl !== null) uncertain.add('image');
    await this.products.completeExtraction(productId, {
      status: 'DONE',
      fields: {
        ...(validated.title !== null ? { title: validated.title } : {}),
        ...(validated.description !== null ? { description: validated.description } : {}),
        ...(validated.unitPriceMinor !== null ? { unitPriceMinor: validated.unitPriceMinor } : {}),
        ...(validated.currency !== null ? { currency: validated.currency } : {}),
        ...(validated.merchant !== null ? { merchant: validated.merchant } : {}),
      },
      imageKey,
      uncertainFields: [...uncertain],
      truncated,
      priceCheckedAt: validated.unitPriceMinor !== null ? this.clock.now() : null,
    });
  }

  private async fail(productId: string): Promise<void> {
    await this.products.completeExtraction(productId, {
      status: 'FAILED',
      fields: {},
      imageKey: null,
      uncertainFields: [],
      truncated: false,
      priceCheckedAt: null,
    });
  }
}

/** EXT-06 : une extraction en cours depuis plus de 2 minutes (arrêt du serveur) passe en `FAILED`. */
@Injectable()
export class FailStaleExtractions {
  constructor(
    private readonly products: ProductRepository,
    private readonly clock: Clock,
  ) {}

  execute(): Promise<number> {
    return this.products.failStaleExtractions(
      new Date(this.clock.now().getTime() - STALE_EXTRACTION_MS),
    );
  }
}
