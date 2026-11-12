import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { buildOpenApiDocument } from './openapi/document';
import { AppConfig } from './platform/config/env';

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Pas de fichier .env : variables fournies par l'environnement d'exécution.
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);

  const { env } = app.get(AppConfig);
  // Documentation interactive en développement seulement (13, question 1).
  if (env.NODE_ENV === 'development') {
    SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
  }

  await app.listen(env.PORT);
}

void main();
