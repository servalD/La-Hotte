import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';
import type { FieldError } from './problem-details';

/** Erreur de validation portant le détail par champ (API-14). */
export class RequestValidationException extends BadRequestException {
  constructor(readonly fieldErrors: FieldError[]) {
    super('VALIDATION_FAILED');
  }
}

export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.entries(error.constraints ?? {}).map(([code, message]) => ({
      field,
      code,
      message,
    }));
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

/**
 * SEC-10 : validation par schéma à la frontière, champs inconnus rejetés.
 * La valeur reçue n'est jamais renvoyée dans le message (contenu utilisateur).
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) => new RequestValidationException(flattenValidationErrors(errors)),
  });
}
