import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { applyRouting } from '../bootstrap';
import { buildOpenApiDocument } from './document';

/**
 * Émet apps/api/openapi.json sans démarrer le serveur ni se connecter à quoi que ce soit
 * (mode aperçu : les fournisseurs ne sont pas instanciés). ADR 0009, point 2.
 */
async function emit(): Promise<void> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  applyRouting(app);
  const document = buildOpenApiDocument(app);
  const target = resolve(__dirname, '../../openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await app.close();
  process.stdout.write(`openapi.json écrit : ${target}\n`);
}

void emit();
