#!/usr/bin/env bash
# Sauvegardes (DEP-05, DEP-06, SEC-23, RGPD-01). Chiffrées avec `age` vers une clé publique ; la
# clé privée n'est jamais sur le serveur. Copiées hors du serveur par BACKUP_OFFSITE_CMD.
#
#   backup.sh base     base physique (pg_basebackup) + export logique (pg_dump), une fois par jour
#   backup.sh wal      journaux de transactions archivés, toutes les 5 minutes (perte ≤ 15 min)
#   backup.sh images   volume des images, une fois par jour
#   backup.sh prune    rétention : fichiers de plus de BACKUP_RETENTION_DAYS jours (30)
#
# Planification (cron de l'hôte, voir README) : `*/5 * * * * backup.sh wal`,
# `15 3 * * * backup.sh base && backup.sh images && backup.sh prune`.
#
# Les commandes de lecture sont remplaçables (tests de CI, autre hôte) : PG_DUMP_CMD,
# PG_BASEBACKUP_CMD, WAL_TAR_CMD, WAL_PRUNE_CMD, IMAGES_TAR_CMD. Aucune ne reçoit de secret en
# argument ; aucune sortie ne contient de donnée (OBS-20).
set -euo pipefail

: "${BACKUP_DIR:?BACKUP_DIR manquant}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT manquant}"
COMPOSE="${COMPOSE:-docker compose --env-file .env}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$BACKUP_DIR"

seal() {
  # $1 : fichier de destination. Écrit d'abord un fichier partiel, renommé une fois complet.
  local target="$1"
  age -r "$BACKUP_AGE_RECIPIENT" -o "$target.partial"
  mv "$target.partial" "$target"
  sha256sum "$target" > "$target.sha256"
  echo "écrit : $(basename "$target") ($(stat -c %s "$target") octets)"
}

offsite() {
  if [[ -n "${BACKUP_OFFSITE_CMD:-}" ]]; then
    bash -c "$BACKUP_OFFSITE_CMD"
  fi
}

case "${1:-}" in
  base)
    PG_BASEBACKUP_CMD="${PG_BASEBACKUP_CMD:-$COMPOSE exec -T postgres pg_basebackup -U wishlist -D - -Ft -X fetch}"
    PG_DUMP_CMD="${PG_DUMP_CMD:-$COMPOSE exec -T postgres pg_dump -U wishlist -d wishlist --format=custom}"
    eval "$PG_BASEBACKUP_CMD" | seal "$BACKUP_DIR/base-$STAMP.tar.age"
    eval "$PG_DUMP_CMD" | seal "$BACKUP_DIR/logical-$STAMP.dump.age"
    offsite
    ;;
  wal)
    # Les journaux déjà copiés hors du serveur sont retirés de l'archive locale.
    WAL_TAR_CMD="${WAL_TAR_CMD:-$COMPOSE exec -T postgres sh -c 'cd /wal-archive && ls | head -n 2000 > /tmp/wal.list && tar -cf - -T /tmp/wal.list'}"
    WAL_PRUNE_CMD="${WAL_PRUNE_CMD:-$COMPOSE exec -T postgres sh -c 'cd /wal-archive && xargs -r rm -f < /tmp/wal.list'}"
    eval "$WAL_TAR_CMD" | seal "$BACKUP_DIR/wal-$STAMP.tar.age"
    offsite
    eval "$WAL_PRUNE_CMD"
    ;;
  images)
    IMAGES_TAR_CMD="${IMAGES_TAR_CMD:-docker run --rm -v lahotte_images:/data:ro alpine:3.22 tar -C /data -cf - .}"
    eval "$IMAGES_TAR_CMD" | seal "$BACKUP_DIR/images-$STAMP.tar.age"
    offsite
    ;;
  prune)
    find "$BACKUP_DIR" -type f -mtime "+$RETENTION" -print -delete
    ;;
  *)
    echo "usage : backup.sh base|wal|images|prune" >&2
    exit 2
    ;;
esac
