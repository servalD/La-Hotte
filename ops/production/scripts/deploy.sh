#!/usr/bin/env bash
# Déploiement (DEP-04) : images analysées en CI, migration compatible avec la version précédente
# (DAT-07), démarrage, vérification de santé, bascule ; retour arrière par les images précédentes.
#
#   deploy.sh <fichier d'images>     ex. images-<sha>.env, publié par la CI
#   deploy.sh rollback               revient au dernier fichier d'images réussi
#
# Un fichier d'images contient API_IMAGE, API_MIGRATE_IMAGE, WEB_IMAGE, FETCHER_IMAGE et RELEASE,
# désignées par empreinte (`@sha256:`), jamais par étiquette.
set -euo pipefail
cd "$(dirname "$0")/.."

STATE=.deploy
mkdir -p "$STATE"
COMPOSE=(docker compose --env-file .env)

health() {
  # La sonde de disponibilité de l'API (OBS-41), par le réseau interne.
  for _ in $(seq 1 30); do
    if "${COMPOSE[@]}" exec -T api node -e \
      "fetch('http://127.0.0.1:4000/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

apply() {
  local images="$1"
  grep -Eq '^(API|API_MIGRATE|WEB|FETCHER)_IMAGE=.+@sha256:[0-9a-f]{64}$' "$images" || {
    echo "fichier d'images invalide : une image sans empreinte" >&2
    exit 2
  }
  cp "$images" "$STATE/candidate.env"
  # Les variables d'images du fichier passent devant celles de `.env`.
  set -a
  # shellcheck disable=SC1090
  . "$STATE/candidate.env"
  set +a
  "${COMPOSE[@]}" pull api web fetcher migrate
  "${COMPOSE[@]}" --profile migrate run --rm migrate
  "${COMPOSE[@]}" up -d --no-deps api web fetcher
  if health; then
    [[ -f "$STATE/current.env" ]] && cp "$STATE/current.env" "$STATE/previous.env"
    cp "$STATE/candidate.env" "$STATE/current.env"
    echo "déployé : ${RELEASE:-sans version}"
  else
    echo "santé non atteinte : retour arrière" >&2
    rollback
    exit 1
  fi
}

rollback() {
  [[ -f "$STATE/previous.env" ]] || {
    echo "aucune version précédente" >&2
    exit 1
  }
  set -a
  # shellcheck disable=SC1090
  . "$STATE/previous.env"
  set +a
  # DAT-07 : la base reste à la nouvelle migration, compatible avec le code précédent.
  "${COMPOSE[@]}" up -d --no-deps api web fetcher
  health
  cp "$STATE/previous.env" "$STATE/current.env"
  echo "revenu à : ${RELEASE:-sans version}"
}

case "${1:-}" in
  rollback) rollback ;;
  "") echo "usage : deploy.sh <fichier d'images> | rollback" >&2; exit 2 ;;
  *) apply "$1" ;;
esac
