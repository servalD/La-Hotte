# syntax=docker/dockerfile:1.7
# Image du service de récupération (EXT-40 à EXT-46, ADR 0016, DEP-02, DEP-08). Construite depuis
# la racine du dépôt :
#   docker build -f apps/fetcher/Dockerfile -t lahotte-fetcher .
# Seul service qui joint Internet ; il n'a accès à aucune base (réseau dédié).
ARG NODE_IMAGE=node:22.20.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @wishlist/fetcher build
RUN pnpm --filter @wishlist/fetcher deploy --legacy --prod /out \
    && rm -rf /out/dist \
    && cp -r apps/fetcher/dist /out/dist

FROM ${NODE_IMAGE} AS runtime
# Mises à jour de sécurité de la base (CI-05), et ni npm, ni corepack, ni pnpm dans l'image
# livrée : l'application n'en a pas besoin et leurs dépendances ne doivent pas y entrer.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
       /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
ENV NODE_ENV=production \
    FETCHER_HOST=0.0.0.0 \
    FETCHER_PORT=4100
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4100/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
