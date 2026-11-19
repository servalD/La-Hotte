# syntax=docker/dockerfile:1.7
# Image de l'API (DEP-02, DEP-03, DEP-04, DEP-08). Construite depuis la racine du dépôt :
#   docker build -f apps/api/Dockerfile --target runtime -t lahotte-api .
#   docker build -f apps/api/Dockerfile --target migrate -t lahotte-api-migrate .
# Construction sur Debian 12 (bookworm), exécution sur distroless Debian 12 : même glibc et même
# OpenSSL 3, donc le moteur Prisma généré à la construction (`debian-openssl-3.0.x`) s'y charge.
ARG NODE_IMAGE=node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e

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
ENV npm_config_store_dir=/pnpm/store
WORKDIR /repo
# Dépendances d'abord : `pnpm fetch` ne lit que le lockfile, donc cette couche reste en cache tant
# qu'il ne change pas ; le magasin pnpm est un cache de build partagé entre les trois images.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm --filter @wishlist/api build
# Dépendances de production seulement ; le code construit et le schéma sont copiés à part (ils
# sont ignorés par git, donc par `pnpm deploy`).
RUN pnpm --filter @wishlist/api deploy --legacy --prod /out \
    && rm -rf /out/dist /out/prisma \
    && cp -r apps/api/dist /out/dist \
    && cp -r apps/api/prisma /out/prisma
# Client Prisma généré dans les dépendances de production, par la CLI de la construction.
RUN cd /out && node /repo/apps/api/node_modules/prisma/build/index.js generate --schema prisma/schema.prisma
# Variantes musl, outillage de bundler, CLI Prisma : jamais chargés en exécution (docker/build/prune-node-modules.mjs).
COPY docker/build/prune-node-modules.mjs /tmp/prune-node-modules.mjs
RUN node /tmp/prune-node-modules.mjs /out bundlers prisma-cli \
    # Point de montage du volume des images (IMAGE_STORAGE_DIR) : un volume neuf prend le
    # propriétaire du dossier de l'image, qui doit donc exister et appartenir à l'utilisateur.
    && mkdir -p /skel/images
# CLI Prisma seule, à sa version exacte, pour l'image de migration : rien d'autre de la construction.
COPY apps/api/docker/migrate-package.mjs /tmp/migrate-package.mjs
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store mkdir /migrate \
    && node /tmp/migrate-package.mjs /repo/apps/api/node_modules/prisma/package.json /migrate/package.json \
    && cd /migrate \
    && pnpm install --prod --config.node-linker=hoisted

# Images livrées : distroless (DEP-08), ni shell, ni gestionnaire de paquets, ni npm ; Node, glibc,
# OpenSSL et les certificats seulement. Utilisateur `nonroot` (65532). Le code appartient à root :
# le processus ne peut pas le modifier, même sans `read_only`. Point d'entrée : `/nodejs/bin/node`.

# Migrations au déploiement (DEP-04, DAT-07) : rôle propriétaire, `DATABASE_MIGRATION_URL`.
FROM ${RUNTIME_IMAGE} AS migrate
ENV CHECKPOINT_DISABLE=1
WORKDIR /app
COPY --from=build /out/prisma /app/prisma
COPY --from=build /migrate /migrate
CMD ["/migrate/node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"]

FROM ${RUNTIME_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
# DEP-03 : jamais root ; système de fichiers en lecture seule, images dans le volume.
COPY --from=build --chown=65532:65532 /skel/images /data/images
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:4000/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]
