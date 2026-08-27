#!/usr/bin/env bash
# =============================================================================
# Granete — Automated Backup Script
# =============================================================================
# Backs up both PostgreSQL and media files (catalog images, project photos).
# Designed to be run via cron on the production VPS.
#
# Usage:
#   scripts/backup.sh                        # full backup
#   scripts/backup.sh --db-only              # PostgreSQL only
#   scripts/backup.sh --media-only           # media volume only
#   scripts/backup.sh --retention-days=7     # override rotation (default: 14)
#
# Environment (override defaults):
#   COMPOSE_FILE    path to compose file   (default: docker-compose.prod.yml)
#   BACKUP_DIR      backup destination     (default: /var/backups/granete)
#   POSTGRES_USER   database user          (default: granete_prod)
#   POSTGRES_DB     database name          (default: granete_prod)
#   MEDIA_VOLUME    docker volume name     (default: granete_media_data)
#   RETENTION_DAYS  days to keep backups   (default: 14)
# =============================================================================
set -euo pipefail

# ---------- Configurable paths (override via environment) ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_DIR/docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/granete}"
POSTGRES_USER="${POSTGRES_USER:-granete_prod}"
POSTGRES_DB="${POSTGRES_DB:-granete_prod}"
MEDIA_VOLUME="${MEDIA_VOLUME:-granete_media_data}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# ---------- Flags ----------
DO_DB=true
DO_MEDIA=true

for arg in "$@"; do
  case "$arg" in
    --db-only)      DO_MEDIA=false ;;
    --media-only)   DO_DB=false ;;
    --retention-days=*) RETENTION_DAYS="${arg#*=}" ;;
    --help|-h)
      sed -n '2,/^# ==/p' "$0" | head -n -1 | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
    *)
      echo "ERROR: Unknown flag '$arg'. Use --help for usage." >&2
      exit 1
      ;;
  esac
done

# ---------- Pre-flight checks ----------
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: docker not found in PATH" >&2
  exit 1
fi

# ---------- Timestamp ----------
TIMESTAMP="$(date '+%Y-%m-%d_%H%M%S')"
mkdir -p "$BACKUP_DIR"

# Secure permissions on backup directory
chmod 700 "$BACKUP_DIR"

# ---------- Helper: compose command ----------
dc() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

# ---------- PostgreSQL Backup ----------
if [[ "$DO_DB" == "true" ]]; then
  DB_FILE="$BACKUP_DIR/granete_${TIMESTAMP}.sql.gz"

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting PostgreSQL backup..."
  echo "  → $DB_FILE"

  # Verify postgres is running
  if ! dc exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" &>/dev/null; then
    echo "ERROR: PostgreSQL is not accepting connections. Aborting DB backup." >&2
    exit 1
  fi

  dc exec -T postgres \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges \
    | gzip > "$DB_FILE"

  if [[ ! -s "$DB_FILE" ]]; then
    echo "ERROR: DB backup file is empty. Something went wrong." >&2
    rm -f "$DB_FILE"
    exit 1
  fi

  DB_SIZE="$(du -h "$DB_FILE" | cut -f1)"
  echo "  ✓ PostgreSQL backup complete ($DB_SIZE)"
fi

# ---------- Media Backup ----------
if [[ "$DO_MEDIA" == "true" ]]; then
  MEDIA_FILE="$BACKUP_DIR/granete_media_${TIMESTAMP}.tar.gz"

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting media volume backup..."
  echo "  → $MEDIA_FILE"

  # Verify the volume exists
  if ! docker volume inspect "$MEDIA_VOLUME" &>/dev/null; then
    echo "WARNING: Volume '$MEDIA_VOLUME' does not exist. Skipping media backup." >&2
    DO_MEDIA=false
  else
    # Use a throwaway Alpine container to tar the volume contents
    docker run --rm \
      -v "$MEDIA_VOLUME":/data:ro \
      -v "$BACKUP_DIR":/backup \
      alpine tar czf "/backup/granete_media_${TIMESTAMP}.tar.gz" -C /data .

    if [[ ! -s "$MEDIA_FILE" ]]; then
      echo "ERROR: Media backup file is empty. Something went wrong." >&2
      rm -f "$MEDIA_FILE"
      exit 1
    fi

    MEDIA_SIZE="$(du -h "$MEDIA_FILE" | cut -f1)"
    echo "  ✓ Media backup complete ($MEDIA_SIZE)"
  fi
fi

# ---------- Rotation ----------
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rotating backups older than ${RETENTION_DAYS} days..."

DB_DELETED=$(find "$BACKUP_DIR" -name 'granete_*.sql.gz' -mtime +"$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')
MEDIA_DELETED=$(find "$BACKUP_DIR" -name 'granete_media_*.tar.gz' -mtime +"$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')

echo "  ✓ Rotated: ${DB_DELETED} DB backup(s), ${MEDIA_DELETED} media backup(s)"

# ---------- Summary ----------
echo ""
echo "========================================"
echo " Backup complete: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
echo " Location: $BACKUP_DIR"
echo " DB file:  granete_${TIMESTAMP}.sql.gz"
echo " Media:    granete_media_${TIMESTAMP}.tar.gz"
echo " Retention: ${RETENTION_DAYS} days"
echo "========================================"
echo ""
echo "NOTE: This is a local backup. For disaster recovery, copy backups to"
echo "an offsite location (rsync to a second server, S3-compatible bucket,"
echo "or USB drive stored physically). Example:"
echo "  rsync -avz $BACKUP_DIR/ user@backup-server:/backups/granete/"
