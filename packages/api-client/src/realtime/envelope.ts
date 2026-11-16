import { z } from 'zod';

// Écrit à la main (API-05). Enveloppe commune des événements serveur (API-32) :
// `{ type, room, at, data, seq? }`. `data` ne porte que des identifiants (RT-08) ; `seq` n'existe
// que sur `notification.created` (RT-12). Un schéma par type d'événement, strict : un champ
// inattendu (une donnée d'offreur glissée) fait échouer la lecture.

export function envelope<TType extends string, TData extends z.ZodType>(type: TType, data: TData) {
  return z
    .object({
      type: z.literal(type),
      room: z.string().max(80),
      at: z.iso.datetime(),
      data,
      seq: z.number().int().positive().optional(),
    })
    .strict();
}

export type Envelope<TType extends string, TData> = {
  type: TType;
  room: string;
  at: string;
  data: TData;
  seq?: number;
};
