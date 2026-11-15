import { BadRequestException } from '@nestjs/common';

/** API-17 : `If-Match: "3"` (ou `3`, ou `W/"3"`). Absent ou mal formé : `400`. */
export function parseIfMatch(header: string | undefined): number {
  const match = /^(?:W\/)?"?([1-9][0-9]{0,9})"?$/.exec(header?.trim() ?? '');
  const version = match?.[1] ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(version)) throw new BadRequestException();
  return version;
}
