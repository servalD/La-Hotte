# syntax=docker/dockerfile:1.7
# Image du web (DEP-02, DEP-03, DEP-04, DEP-08). Construite depuis la racine du dépôt :
#   docker build -f apps/web/Dockerfile -t lahotte-web .
# Les variables du navigateur sont inscrites au build (OBS-47) ; aucune n'est un secret.
ARG NODE_IMAGE=node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs26-debian13:nonroot@sha256:1d736cf8b5716c07a245301f92717143215d248fd55771ee1936ef4b3302e531

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_DEPLOY_ENVIRONMENT=production
ARG NEXT_PUBLIC_RELEASE=
# Cible du relais /api et /realtime : lue par next.config.ts au build (docker compose local : http://api:4000).
ARG API_ORIGIN=http://localhost:4000
ENV API_ORIGIN=${API_ORIGIN}
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_DEPLOY_ENVIRONMENT=${NEXT_PUBLIC_DEPLOY_ENVIRONMENT} \
    NEXT_PUBLIC_RELEASE=${NEXT_PUBLIC_RELEASE}
RUN npm install --global pnpm@10.17.1 # Node 26 n'embarque plus corepack
ENV npm_config_store_dir=/pnpm/store
WORKDIR /repo
# Dépendances d'abord : `pnpm fetch` ne lit que le lockfile, donc cette couche reste en cache tant
# qu'il ne change pas ; le magasin pnpm est un cache de build partagé entre les trois images.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm --filter @wishlist/web build
# Variantes musl et outillage de bundler : jamais chargés par le serveur (docker/build/prune-node-modules.mjs).
COPY docker/build/prune-node-modules.mjs /tmp/prune-node-modules.mjs
RUN node /tmp/prune-node-modules.mjs /repo/apps/web/.next/standalone bundlers

# Distroless (DEP-08) : ni shell, ni gestionnaire de paquets, ni npm ; utilisateur `nonroot` (65532),
# code appartenant à root.
FROM ${RUNTIME_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# Sortie autonome : serveur et dépendances tracées, puis fichiers statiques à côté (pas de
# dossier `public` : icônes et manifeste sont des routes).
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/manifest.webmanifest').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
USER 65532:65532
CMD ["apps/web/server.js"]
