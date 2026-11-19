# syntax=docker/dockerfile:1.7
# Image du service de récupération (EXT-40 à EXT-46, ADR 0016, DEP-02, DEP-08). Construite depuis
# la racine du dépôt :
#   docker build -f apps/fetcher/Dockerfile -t lahotte-fetcher .
# Seul service qui joint Internet ; il n'a accès à aucune base (réseau dédié).
ARG NODE_IMAGE=node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
ENV npm_config_store_dir=/pnpm/store
WORKDIR /repo
# Dépendances d'abord : `pnpm fetch` ne lit que le lockfile, donc cette couche reste en cache tant
# qu'il ne change pas ; le magasin pnpm est un cache de build partagé entre les trois images.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm --filter @wishlist/fetcher build
RUN pnpm --filter @wishlist/fetcher deploy --legacy --prod /out \
    && rm -rf /out/dist \
    && cp -r apps/fetcher/dist /out/dist
# Variantes musl de sharp : l'image est en glibc (docker/build/prune-node-modules.mjs).
COPY docker/build/prune-node-modules.mjs /tmp/prune-node-modules.mjs
RUN node /tmp/prune-node-modules.mjs /out

# Distroless (DEP-08) : ni shell, ni gestionnaire de paquets, ni npm ; utilisateur `nonroot` (65532),
# code appartenant à root. sharp embarque sa libvips (glibc, libstdc++ de l'image).
FROM ${RUNTIME_IMAGE} AS runtime
ENV NODE_ENV=production \
    FETCHER_HOST=0.0.0.0 \
    FETCHER_PORT=4100
WORKDIR /app
COPY --from=build /out /app
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:4100/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["--enable-source-maps", "dist/main.js"]
