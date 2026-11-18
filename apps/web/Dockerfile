# syntax=docker/dockerfile:1.7
# Image du web (DEP-02, DEP-03, DEP-04, DEP-08). Construite depuis la racine du dépôt :
#   docker build -f apps/web/Dockerfile -t lahotte-web .
# Les variables du navigateur sont inscrites au build (OBS-47) ; aucune n'est un secret.
ARG NODE_IMAGE=node:22.20.0-bookworm-slim

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
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @wishlist/web build

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
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# Sortie autonome : serveur et dépendances tracées, puis fichiers statiques à côté (pas de
# dossier `public` : icônes et manifeste sont des routes).
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/manifest.webmanifest').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
