import { BadRequestException } from '@nestjs/common';

/** API-15 : curseur opaque (date de création et identifiant), en base64url. */
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (!id || !/^[0-9a-f-]{36}$/.test(id) || Number.isNaN(at.getTime())) {
    throw new BadRequestException();
  }
  return { at, id };
}
