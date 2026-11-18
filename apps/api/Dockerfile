# syntax=docker/dockerfile:1.7
# Image de l'API (DEP-02, DEP-03, DEP-04, DEP-08). Construite depuis la racine du dépôt :
#   docker build -f apps/api/Dockerfile --target runtime -t lahotte-api .
#   docker build -f apps/api/Dockerfile --target migrate -t lahotte-api-migrate .
# Même base pour la construction et l'exécution : le moteur Prisma généré est celui de l'image.
ARG NODE_IMAGE=node:22.20.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    TURBO_TELEMETRY_DISABLED=1
# OpenSSL pour le moteur Prisma (détecté à la génération et à l'exécution).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
WORKDIR /repo
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
# CLI Prisma seule, à sa version exacte, pour l'image de migration : rien d'autre de la construction.
COPY apps/api/docker/migrate-package.mjs /tmp/migrate-package.mjs
RUN mkdir /migrate \
    && node /tmp/migrate-package.mjs /repo/apps/api/node_modules/prisma/package.json /migrate/package.json \
    && cd /migrate \
    && pnpm install --prod --config.node-linker=hoisted

# Base des images livrées : mises à jour de sécurité (CI-05), et ni npm, ni corepack, ni pnpm,
# dont l'application n'a pas besoin et dont les dépendances ne doivent pas y entrer.
FROM ${NODE_IMAGE} AS hardened
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
       /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

# Migrations au déploiement (DEP-04, DAT-07) : rôle propriétaire, `DATABASE_MIGRATION_URL`.
FROM hardened AS migrate
WORKDIR /app
COPY --from=build --chown=node:node /out/prisma /app/prisma
COPY --from=build --chown=node:node /migrate /migrate
USER node
CMD ["node", "/migrate/node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"]

FROM hardened AS runtime
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
