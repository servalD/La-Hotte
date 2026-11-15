import sharp from 'sharp';
import { FetchError } from '../net/errors.js';

// EXT-45, EXT-11, EXT-46 : toute image est décodée puis réencodée ici, jamais stockée telle quelle.
// Le format est reconnu à ses premiers octets avant tout décodage : le SVG (et tout ce qui n'est pas
// une image matricielle connue) n'atteint jamais un décodeur. Le réencodage retire les métadonnées
// (EXIF, GPS, appareil) : sharp n'en recopie aucune sans `withMetadata`.

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 1600;

type RasterFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';

/** Reconnaît le format à sa signature ; `null` pour tout le reste (SVG, HTML, PDF…). */
export function sniffFormat(bytes: Buffer): RasterFormat | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (bytes.toString('latin1', 0, 6) === 'GIF87a' || bytes.toString('latin1', 0, 6) === 'GIF89a') {
    return 'gif';
  }
  if (bytes.toString('latin1', 4, 8) === 'ftyp') {
    const brand = bytes.toString('latin1', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  return null;
}

export interface ReencodedImage {
  readonly contentType: 'image/webp';
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}

export async function reencode(input: Buffer): Promise<ReencodedImage> {
  if (input.length === 0 || input.length > IMAGE_MAX_BYTES) throw new FetchError('IMAGE_REJECTED');
  const format = sniffFormat(input);
  if (!format) throw new FetchError('IMAGE_REJECTED');
  try {
    const decoder = sharp(input, {
      limitInputPixels: MAX_PIXELS,
      failOn: 'error',
      animated: false,
    });
    const metadata = await decoder.metadata();
    // Le décodeur doit confirmer la signature (pas de fichier polyglotte).
    const decodedAs = metadata.format === 'heif' ? 'avif' : metadata.format;
    if (decodedAs !== format) throw new FetchError('IMAGE_REJECTED');
    const { data, info } = await decoder
      .rotate() // orientation EXIF appliquée avant d'être oubliée
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { contentType: 'image/webp', bytes: data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof FetchError) throw error;
    throw new FetchError('IMAGE_REJECTED');
  }
}
