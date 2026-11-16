import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../../platform/config/env';
import { ImageStore } from '../domain/product.ports';

const KEY = /^[0-9a-f]{32}$/;
const TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/**
 * ADR 0016 : dossier local, une image par clé aléatoire de 128 bits (EXT-47). Les images arrivent
 * déjà réencodées par le `fetcher` (EXT-45, EXT-46) ; le type est lu de l'extension, jamais du
 * contenu.
 */
@Injectable()
export class DiskImageStore extends ImageStore {
  private readonly root: string;

  constructor(config: AppConfig) {
    super();
    this.root = resolve(config.env.IMAGE_STORAGE_DIR);
  }

  async put(bytes: Buffer, contentType: string): Promise<string> {
    const extension = TYPES[contentType];
    if (!extension) throw new Error('Type d’image non pris en charge');
    const key = randomBytes(16).toString('hex');
    const dir = join(this.root, key.slice(0, 2));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${key}.${extension}`), bytes, { flag: 'wx' });
    return key;
  }

  async get(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    if (!KEY.test(key)) return null;
    for (const [contentType, extension] of Object.entries(TYPES)) {
      try {
        const bytes = await readFile(join(this.root, key.slice(0, 2), `${key}.${extension}`));
        return { bytes, contentType };
      } catch {
        // Essai suivant.
      }
    }
    return null;
  }
}
