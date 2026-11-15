import type { INestApplication, Type } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { API_PREFIX } from '../../src/bootstrap';
import {
  ACCESS_MARK,
  OIDC_CALLBACK_MARK,
} from '../../src/modules/identity/presentation/decorators';

export interface RouteInfo {
  readonly method: string;
  /** Chemin complet, paramètres en `:nom`. */
  readonly path: string;
  readonly controller: Type;
  /** Marques d'accès posées sur la méthode et sur le contrôleur. */
  readonly marks: string[];
  readonly oidcCallback: boolean;
}

const join = (...parts: (string | undefined)[]): string =>
  `/${parts
    .flatMap((part) => (part ?? '').split('/'))
    .filter(Boolean)
    .join('/')}`;

/** Toutes les routes montées par l'application, avec leurs marques (ADR 0013). */
export function listRoutes(app: INestApplication): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as Type | null;
      if (!controller) continue;
      const base = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
      const classMark = Reflect.getMetadata(ACCESS_MARK, controller) as string | undefined;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue;
        const method =
          RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? '?';
        const prefix = base?.startsWith('health') ? '' : API_PREFIX;
        const handlerMark = Reflect.getMetadata(ACCESS_MARK, handler) as string | undefined;
        routes.push({
          method,
          path: join(prefix, base, path),
          controller,
          marks: [handlerMark, classMark].filter((mark): mark is string => mark !== undefined),
          oidcCallback: Reflect.getMetadata(OIDC_CALLBACK_MARK, handler) === true,
        });
      }
    }
  }
  return routes;
}
