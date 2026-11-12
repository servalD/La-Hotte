import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { FieldErrorDto, ProblemDetailsDto } from '../platform/http/problem-details.dto';
import { PROBLEM_CONTENT_TYPE } from '../platform/http/problem-details';

const PROBLEM_REF = { $ref: '#/components/schemas/ProblemDetailsDto' };

function sortKeys<T extends Record<string, unknown>>(obj: T | undefined): T | undefined {
  if (!obj) return obj;
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) as T;
}

/**
 * Document OpenAPI du contrat (ADR 0009, API-01).
 * - operationId = nom de la méthode du contrôleur : il devient le nom du hook généré.
 * - Toute opération déclare la réponse d'erreur `application/problem+json` (API-14).
 * - Clés triées : le fichier versionné ne change que si le contrat change (API-02).
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('La Hotte API')
    .setVersion('1')
    .setDescription('Contrat de l’API La Hotte. Généré depuis les DTO NestJS, ne pas éditer.')
    .addCookieAuth('session')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
    extraModels: [ProblemDetailsDto, FieldErrorDto],
  });

  const seen = new Set<string>();
  for (const pathItem of Object.values(document.paths)) {
    for (const method of ['get', 'put', 'post', 'delete', 'patch'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      if (operation.operationId) {
        if (seen.has(operation.operationId)) {
          throw new Error(`operationId en double : ${operation.operationId}`);
        }
        seen.add(operation.operationId);
      }
      operation.responses.default = {
        description: 'Erreur (RFC 9457)',
        content: { [PROBLEM_CONTENT_TYPE]: { schema: PROBLEM_REF } },
      };
    }
  }

  document.paths = sortKeys(document.paths) ?? {};
  if (document.components?.schemas) {
    document.components.schemas = sortKeys(document.components.schemas);
  }
  return document;
}
