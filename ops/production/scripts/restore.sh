#!/usr/bin/env bash
# Restauration d'un export logique (SEC-23, DEP-06, critère de 09 : « restauration faite et
# chronométrée »). Restaure dans une base **neuve**, jamais par-dessus la base en service.
#
#   restore.sh <fichier logical-*.dump.age>
#
# Variables : AGE_IDENTITY (clé privée du coffre, apportée pour l'occasion, jamais laissée sur le
# serveur), TARGET_URL (base vide qui reçoit la restauration, rôle propriétaire). La reprise à un
# instant donné (base physique + journaux) suit la procédure manuelle du README.
#
# Sortie : durée de chaque étape et nombre de lignes par table, sans contenu (OBS-20).
set -euo pipefail

FILE="${1:?usage : restore.sh <fichier .dump.age>}"
: "${AGE_IDENTITY:?AGE_IDENTITY manquant}"
: "${TARGET_URL:?TARGET_URL manquant}"

start=$(date +%s)
if [[ -f "$FILE.sha256" ]]; then
  sha256sum -c "$FILE.sha256" >/dev/null
  echo "empreinte vérifiée"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
age -d -i "$AGE_IDENTITY" -o "$work/db.dump" "$FILE"
decrypted=$(date +%s)
echo "déchiffré en $((decrypted - start)) s"

# Les rôles (DAT-03) existent dans la base cible : ils sont créés par l'initialisation du serveur.
pg_restore --dbname="$TARGET_URL" --no-owner --role=wishlist --exit-on-error --single-transaction "$work/db.dump"
restored=$(date +%s)
echo "restauré en $((restored - decrypted)) s"

# Contrôles : tables présentes, migrations appliquées, journaux en ajout seul toujours protégés.
psql "$TARGET_URL" -At -v ON_ERROR_STOP=1 -c "
  SELECT 'tables ' || count(*) FROM pg_tables WHERE schemaname = 'public'"
psql "$TARGET_URL" -At -v ON_ERROR_STOP=1 -c "
  SELECT 'migrations ' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL"
# DAT-02 : aucune table en ajout seul ne devient modifiable par le rôle applicatif.
writable=$(psql "$TARGET_URL" -At -v ON_ERROR_STOP=1 -c "
  SELECT count(*) FROM unnest(ARRAY['ledger_entry','audit_log','security_log','moderation_decision']) t
  WHERE has_table_privilege('wishlist_app', t, 'UPDATE') OR has_table_privilege('wishlist_app', t, 'DELETE')")
if [[ "$writable" != "0" ]]; then
  echo "échec : une table en ajout seul est modifiable après restauration" >&2
  exit 1
fi
echo "ajout seul vérifié"
echo "restauration complète en $(( $(date +%s) - start )) s"
