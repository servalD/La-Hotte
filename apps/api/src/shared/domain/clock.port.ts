/** Heure courante, injectée pour que le domaine reste déterministe en test. */
export abstract class Clock {
  abstract now(): Date;
}
