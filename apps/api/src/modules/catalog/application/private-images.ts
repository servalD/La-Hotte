import { Injectable } from '@nestjs/common';
import { FetcherUnavailableError, ImageRejectedError } from '../domain/extraction.errors';
import { PageFetcher } from '../domain/page-fetcher.port';
import { ImageStore } from '../domain/product.ports';

/**
 * Images privées d'un autre module, par exemple le justificatif d'achat (CPT-62, ADR 0019) :
 * même chemin que la photo d'une fiche (décodage et ré-encodage isolés, sans métadonnées,
 * EXT-46), même magasin. La clé n'est jamais rendue au client : le module appelant sert l'image
 * lui-même, après sa propre décision d'accès.
 */
@Injectable()
export class PrivateImages {
  constructor(
    private readonly fetcher: PageFetcher,
    private readonly images: ImageStore,
  ) {}

  async store(photo: Buffer): Promise<string> {
    const image = await this.fetcher.reencode(photo);
    if (!image.ok) {
      if (image.failure === 'UNAVAILABLE') throw new FetcherUnavailableError();
      throw new ImageRejectedError();
    }
    return this.images.put(image.bytes, image.contentType);
  }

  read(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    return this.images.get(key);
  }
}
