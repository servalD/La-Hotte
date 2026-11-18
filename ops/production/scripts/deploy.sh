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

# Lit un fichier d'images sans l'exécuter : chaque ligne doit être une affectation attendue, les
# quatre images désignées par empreinte ; toute autre ligne fait refuser le fichier.
load_images() {
  local file="$1" line key value
  local -A seen=()
  # Une valeur absente du fichier ne doit pas rester celle d'un fichier lu avant.
  unset RELEASE
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" =~ ^(API|API_MIGRATE|WEB|FETCHER)_IMAGE=([a-z0-9./_:-]+@sha256:[0-9a-f]{64})$ ]]; then
      key="${BASH_REMATCH[1]}_IMAGE"
      value="${BASH_REMATCH[2]}"
    elif [[ "$line" =~ ^RELEASE=([A-Za-z0-9._-]{1,64})$ ]]; then
      key=RELEASE
      value="${BASH_REMATCH[1]}"
    else
      echo "fichier d'images invalide : ligne inattendue" >&2
      exit 2
    fi
    [[ -z "${seen[$key]:-}" ]] || {
      echo "fichier d'images invalide : $key en double" >&2
      exit 2
    }
    seen[$key]=1
    # Les variables d'images du fichier passent devant celles de `.env`.
    export "$key=$value"
  done < "$file"
  for key in API_IMAGE API_MIGRATE_IMAGE WEB_IMAGE FETCHER_IMAGE; do
    [[ -n "${seen[$key]:-}" ]] || {
      echo "fichier d'images invalide : $key manque" >&2
      exit 2
    }
  done
}

apply() {
  local images="$1"
  # Un seul déploiement à la fois.
  exec 9> "$STATE/lock"
  flock -n 9 || {
    echo "un autre déploiement est en cours" >&2
    exit 4
  }
  # Copie d'abord, puis validation et lecture de la copie : le fichier lu est celui conservé.
  cp "$images" "$STATE/candidate.env"
  load_images "$STATE/candidate.env"
  "${COMPOSE[@]}" pull api web fetcher migrate
  "${COMPOSE[@]}" --profile migrate run --rm migrate
  # Un échec du démarrage lui-même ramène aussi à la version en service.
  if "${COMPOSE[@]}" up -d --no-deps api web fetcher && health; then
    [[ -f "$STATE/current.env" ]] && cp "$STATE/current.env" "$STATE/previous.env"
    cp "$STATE/candidate.env" "$STATE/current.env"
    echo "déployé : ${RELEASE:-sans version}"
  else
    echo "santé non atteinte : retour à la version en service avant ce déploiement" >&2
    restore_running
    exit 1
  fi
}

# Échec d'un déploiement : on revient à la version qui tournait juste avant (`current.env`), la
# seule dont DAT-07 garantit la compatibilité avec la base migrée. Sans elle (premier
# déploiement), les services sont arrêtés plutôt que de laisser tourner le candidat défaillant.
restore_running() {
  if [[ ! -f "$STATE/current.env" ]]; then
    echo "aucune version en service : services arrêtés" >&2
    "${COMPOSE[@]}" stop api web fetcher
    return
  fi
  load_images "$STATE/current.env"
  if ! { "${COMPOSE[@]}" up -d --no-deps api web fetcher && health; }; then
    echo "retour arrière en échec : intervention manuelle nécessaire" >&2
    exit 3
  fi
  echo "revenu à : ${RELEASE:-sans version}"
}

# Retour arrière manuel vers la version précédente (`deploy.sh rollback`).
rollback() {
  [[ -f "$STATE/previous.env" ]] || {
    echo "aucune version précédente" >&2
    exit 1
  }
  exec 9> "$STATE/lock"
  flock -n 9 || {
    echo "un autre déploiement est en cours" >&2
    exit 4
  }
  load_images "$STATE/previous.env"
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
