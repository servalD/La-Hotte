import { z } from 'zod';

// Écrit à la main (API-05). Enveloppe commune des événements serveur (API-32).
// Un schéma par type d'événement ; jamais de champ d'offreur facultatif dans un événement
// destiné à un salon public : deux schémas distincts.

export function envelope<TType extends string, TData extends z.ZodTypeAny>(
  type: TType,
  data: TData,
) {
  return z
    .object({
      type: z.literal(type),
      id: z.string().uuid(),
      seq: z.number().int().nonnegative(),
      at: z.string().datetime(),
      data,
    })
    .strict();
}

export type Envelope<TType extends string, TData> = {
  type: TType;
  id: string;
  seq: number;
  at: string;
  data: TData;
};
