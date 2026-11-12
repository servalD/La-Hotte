/** Fournit les identifiants des entités (UUID v7, conventions de 12). */
export abstract class IdGenerator {
  abstract next(): string;
}
