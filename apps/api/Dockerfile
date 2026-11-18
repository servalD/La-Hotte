# syntax=docker/dockerfile:1.7
# Image de l'API (DEP-02, DEP-03, DEP-04). Construite depuis la racine du dépôt :
#   docker build -f apps/api/Dockerfile --target runtime -t lahotte-api .
#   docker build -f apps/api/Dockerfile --target migrate -t lahotte-api-migrate .
# Même base pour la construction et l'exécution : le moteur Prisma généré est celui de l'image.
ARG NODE_IMAGE=node:22.20.0-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
WORKDIR /repo

FROM base AS build
# OpenSSL pour le moteur Prisma (détecté à la génération et à l'exécution).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @wishlist/api build
# Dépendances de production seulement ; le code construit et le schéma sont copiés à part (ils
# sont ignorés par git, donc par `pnpm deploy`).
RUN pnpm --filter @wishlist/api deploy --legacy --prod /out \
    && rm -rf /out/dist /out/prisma \
    && cp -r apps/api/dist /out/dist \
    && cp -r apps/api/prisma /out/prisma
# Client Prisma généré dans les dépendances de production, par la CLI de la construction.
RUN cd /out && node /repo/apps/api/node_modules/prisma/build/index.js generate --schema prisma/schema.prisma

# Migrations au déploiement (DEP-04, DAT-07) : rôle propriétaire, `DATABASE_MIGRATION_URL`.
FROM build AS migrate
WORKDIR /repo/apps/api
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out /app
# DEP-03 : jamais root ; le système de fichiers peut être monté en lecture seule (images dans un
# volume, `IMAGE_STORAGE_DIR`).
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]
