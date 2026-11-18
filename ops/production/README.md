# Production — guide d'exploitation

Spec : `docs/spec/14` (DEP-01 à DEP-07, OBS-05, OBS-16, OBS-27, OBS-40 à OBS-43), `09` (SEC-20 à SEC-23, SEC-43, RGPD-01). Décisions : ADR 0008, ADR 0012, ADR 0021.

L'hébergeur n'est pas encore choisi : rien ici n'en dépend. Il faut un VPS dans l'Union européenne, avec Docker et le plugin Compose, et un pare-feu qui n'ouvre que 80, 443 (TCP et UDP) et l'accès d'administration par clé (DEP-03). Les mises à jour de sécurité de l'hôte doivent être automatiques.

## Fichiers

| Fichier                           | Rôle                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `compose.yaml`                    | Services, réseaux séparés (`internal`, `fetcher`, `egress`, `obs`), conteneurs sans privilèges et en lecture seule |
| `Caddyfile`                       | TLS automatique, en-têtes, même origine pour le web et l'API, hôtes d'exploitation restreints par adresse          |
| `.env.example`, `api.env.example` | Variables, à copier en `.env` et `api.env` (droits 600, jamais versionnés)                                         |
| `postgres/init.sh`                | Rôles DAT-03 au premier démarrage                                                                                  |
| `security.txt`                    | SEC-43, servi à `/.well-known/security.txt`                                                                        |
| `scripts/deploy.sh`               | Déploiement et retour arrière (DEP-04)                                                                             |
| `scripts/backup.sh`               | Sauvegardes chiffrées (DEP-05)                                                                                     |
| `scripts/restore.sh`              | Restauration chronométrée dans une base neuve (SEC-23)                                                             |
| `../observability/alerts.yaml`    | Règles d'alerte versionnées (OBS-05, SEC-32)                                                                       |

## Première installation

1. Copier ce dossier et `ops/observability` sur le serveur (par exemple dans `/srv/lahotte/ops`).
2. Remplir `.env` et `api.env`. Tirer chaque secret au hasard (`openssl rand -base64 48`). `SECRET_ENCRYPTION_KEYS` : une clé de 32 octets, identifiant différent de 0. Un secret ne passe jamais par le dépôt, une commande partagée ou un ticket (SEC-21).
3. Faire pointer les noms d'hôte vers le serveur : `APP_HOST`, `GLITCHTIP_HOST`, `OBSERVE_HOST`. L'application a son propre nom, et aucun autre service ne l'utilise, sur aucun port (DEP-07).
4. `docker compose --env-file .env up -d postgres redis`, puis `scripts/deploy.sh images-<sha>.env` (le fichier d'images est publié par la CI).
5. Premier administrateur (RBAC-03). Le compte doit déjà exister, avoir une adresse vérifiée et un TOTP actif :

   ```sh
   docker compose --env-file .env run --rm --entrypoint node api dist/cli/admin.js grant <email>
   ```

   La commande répond par un seul mot (`granted`, `requirements_not_met`…), jamais par l'adresse. S'il perd son second facteur, le dernier administrateur passe par `recover <email>` : son TOTP et son rôle sont retirés, il en active un nouveau, puis `grant` lui rend le rôle.

6. GlitchTip et OpenObserve : comptes nominatifs avec TOTP (OBS-27), jamais partagés. Créer les règles de `../observability/alerts.yaml`, puis ranger leurs exports dans `../observability/exports/`.

## Déploiement et retour arrière (DEP-04)

```sh
scripts/deploy.sh images-<sha>.env   # migration, démarrage, santé, bascule
scripts/deploy.sh rollback           # images précédentes ; la base reste migrée (DAT-07)
```

Les images sont désignées par leur empreinte, jamais par une étiquette. Le script refuse un fichier où une image n'a pas d'empreinte.

## Sauvegardes (DEP-05, DEP-06)

Cron de l'hôte, utilisateur dédié, depuis ce dossier :

```cron
*/5 * * * *  scripts/backup.sh wal && curl -fsS "$HEARTBEAT_WAL_URL"
15 3 * * *   scripts/backup.sh base && scripts/backup.sh images && scripts/backup.sh prune && curl -fsS "$HEARTBEAT_BASE_URL"
```

- Tout est chiffré avec `age` vers `BACKUP_AGE_RECIPIENT`. La clé privée reste hors du serveur, dans le coffre de l'exploitation.
- `BACKUP_OFFSITE_CMD` copie le dossier hors du serveur, dans l'Union européenne (RGPD-01), sur un stockage qui interdit l'effacement avant le terme (objets immuables).
- Rétention de 30 jours (`prune`), donc sous les 90 jours de RGPD-05.
- PostgreSQL archive ses journaux toutes les 5 minutes au plus (`archive_timeout=300`) et `backup.sh wal` les copie toutes les 5 minutes. La perte de données reste sous les 15 minutes (DEP-06).

## Restauration (SEC-23) : chaque mois, chronométrée

Export logique, le plus rapide à vérifier, dans une base **neuve** :

```sh
docker compose --env-file .env exec postgres createdb -U wishlist restauration
AGE_IDENTITY=/chemin/vers/cle-privee TARGET_URL=postgresql://wishlist:...@127.0.0.1:5432/restauration \
  scripts/restore.sh /var/backups/lahotte/logical-<date>.dump.age
```

Le script affiche les durées et vérifie que les tables en ajout seul restent protégées (DAT-02). Noter la durée dans `docs/roadmap.md`. La remise en service doit tenir dans les 4 heures (DEP-06).

Reprise à un instant donné (perte du serveur), sur un serveur neuf :

1. Déchiffrer la dernière `base-*.tar.age` dans un volume vide (`age -d … | tar -x`).
2. Déchiffrer et déposer les `wal-*.tar.age` postérieures dans `/wal-archive`.
3. Créer `recovery.signal` et régler `restore_command = 'cp /wal-archive/%f %p'` (et `recovery_target_time` si besoin), puis démarrer PostgreSQL.
4. Restaurer le volume des images (`images-*.tar.age`), déployer les images de la dernière version, vérifier `/health/ready`.

La CI rejoue à chaque demande de fusion la sauvegarde chiffrée et la restauration d'un export logique, chronométrées (job `restore`). Elle ne remplace pas l'exercice sur le vrai serveur : la sortie de la phase 7 exige une restauration réussie et chronométrée ici.

## Sonde externe et signal de vie (OBS-41)

Choisir un service de sonde hors du serveur. Il ne reçoit aucune donnée d'utilisateur. Il doit :

- interroger `https://{APP_HOST}/health/ready` chaque minute ;
- surveiller l'expiration du certificat ;
- recevoir les signaux de vie (`HEARTBEAT_*_URL`) : sauvegardes, plus ce signal général, toutes les 5 minutes :

  ```cron
  */5 * * * *  docker compose --env-file .env ps --status running --format '{{.Service}}' | grep -qx api && curl -fsS "$HEARTBEAT_URL"
  ```

## Rétention et accès (OBS-16, OBS-27)

- OpenObserve : journaux 30 jours (`ZO_COMPACT_DATA_RETENTION_DAYS`) ; traces 14 jours et métriques 90 jours, réglées par flux dans l'interface. Il n'est pas sauvegardé (OBS-42).
- GlitchTip : erreurs 90 jours (`GLITCHTIP_MAX_EVENT_LIFE_DAYS`). Sa base suit les sauvegardes, mais sa perte est tolérée.
- Le journal de sécurité et le journal d'audit restent en base, 12 mois (SEC-33). Ils ne sont pas dans OpenObserve.
- Les hôtes d'exploitation répondent `404` hors de `OPS_ALLOWED_IPS`. L'adresse de la CI y figure pendant l'envoi des cartes de source.
