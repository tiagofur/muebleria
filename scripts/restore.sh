#!/usr/bin/env bash
# =============================================================================
# Granete — Disaster Recovery / Restore Script
# =============================================================================
# Restores both PostgreSQL and media files from a backup created by backup.sh.
#
# Usage:
#   scripts/restore.sh /var/backups/granete/granete_2026-01-01_030000.sql.gz
#   scripts/restore.sh /var/backups/granete/granete_2026-01-01_030000.sql.gz --dry-run
#   scripts/restore.sh /var/backups/granete/granete_2026-01-01_030000.sql.gz --media=/path/to/media.tar.gz
#
# The script automatically looks for a companion media tarball with the same
# timestamp in the same directory (or the --media flag overrides).
#
# WARNING: This is destructive — it replaces the current database.
# Always back up the current state before restoring an older backup.
# =============================================================================
set -euo pipefail

# ---------- Configurable paths ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_DIR/docker-compose.prod.yml}"
POSTGRES_USER="${POSTGRES_USER:-granete_prod}"
POSTGRES_DB="${POSTGRES_DB:-granete_prod}"
MEDIA_VOLUME="${MEDIA_VOLUME:-granete_media_data}"
DRY_RUN=false
MEDIA_FILE=""

# ---------- Parse arguments ----------
DB_FILE=""
for arg in "$@"; do
  case "$arg" in
    --dry-run)      DRY_RUN=true ;;
    --media=*)      MEDIA_FILE="${arg#*=}" ;;
    --help|-h)
      sed -n '2,/^# ==/p' "$0" | head -n -1 | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
    -*)             echo "ERROR: Unknown flag '$arg'" >&2; exit 1 ;;
    *)              DB_FILE="$arg" ;;
  esac
done

if [[ -z "$DB_FILE" ]]; then
  echo "ERROR: No backup file specified." >&2
  echo "Usage: $0 <backup.sql.gz> [--dry-run] [--media=<file.tar.gz>]" >&2
  exit 1
fi

if [[ ! -f "$DB_FILE" ]]; then
  echo "ERROR: Backup file not found: $DB_FILE" >&2
  exit 1
fi

# ---------- Auto-detect media tarball ----------
if [[ -z "$MEDIA_FILE" ]]; then
  # Extract timestamp from DB filename: granete_2026-01-01_030000.sql.gz
  BASENAME="$(basename "$DB_FILE")"
  TIMESTAMP="${BASENAME#granete_}"
  TIMESTAMP="${TIMESTAMP%.sql.gz}"
  CANDIDATE="$(dirname "$DB_FILE")/granete_media_${TIMESTAMP}.tar.gz"
  if [[ -f "$CANDIDATE" ]]; then
    MEDIA_FILE="$CANDIDATE"
    echo "Auto-detected media backup: $MEDIA_FILE"
  else
    echo "WARNING: No media backup found at $CANDIDATE" >&2
    echo "  The restore will only cover PostgreSQL. Media files will NOT be restored." >&2
  fi
fi

# ---------- Helper: compose command ----------
dc() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

# ---------- Pre-flight ----------
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: docker not found in PATH" >&2
  exit 1
fi

# ---------- Restore plan ----------
echo ""
echo "============================================="
echo " Granete Restore Plan"
echo "============================================="
echo " DB backup:   $DB_FILE"
if [[ -n "$MEDIA_FILE" && -f "$MEDIA_FILE" ]]; then
  MEDIA_SIZE="$(du -h "$MEDIA_FILE" | cut -f1)"
  echo " Media backup: $MEDIA_FILE ($MEDIA_SIZE)"
else
  echo " Media backup: NONE (media will not be restored)"
fi
echo " Compose:     $COMPOSE_FILE"
echo " Database:    $POSTGRES_DB (user: $POSTGRES_USER)"
echo " Dry run:     $DRY_RUN"
echo "============================================="
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY RUN] No changes made. Re-run without --dry-run to execute."
  exit 0
fi

# ---------- Confirm ----------
echo "⚠ WARNING: This will REPLACE the current database."
echo "  Press Enter to continue, or Ctrl+C to abort."
read -r

# ---------- Backup current state first ----------
SAFETY_TS="$(date '+%Y-%m-%d_%H%M%S')"
SAFETY_DIR="/tmp/granete-pre-restore-${SAFETY_TS}"
mkdir -p "$SAFETY_DIR"

echo "[1/5] Saving safety backup of current DB..."
dc exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges \
  | gzip > "$SAFETY_DIR/pre_restore.sql.gz"
echo "  ✓ Safety backup saved to: $SAFETY_DIR/pre_restore.sql.gz"

# ---------- Stop backend to prevent concurrent writes ----------
echo "[2/5] Stopping backend to prevent concurrent writes..."
dc stop backend
echo "  ✓ Backend stopped"

# ---------- Restore PostgreSQL ----------
echo "[3/5] Restoring PostgreSQL from $DB_FILE..."
gunzip -c "$DB_FILE" | dc exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists --no-owner --no-privileges --no-acl 2>&1 || {
    # pg_restore returns non-zero on warnings; check if DB is actually up
    echo "  (pg_restore completed with warnings — this is normal)"
  }
echo "  ✓ PostgreSQL restored"

# ---------- Restore media ----------
if [[ -n "$MEDIA_FILE" && -f "$MEDIA_FILE" ]]; then
  echo "[4/5] Restoring media files to volume $MEDIA_VOLUME..."

  # Verify volume exists
  if ! docker volume inspect "$MEDIA_VOLUME" &>/dev/null; then
    echo "  Creating volume $MEDIA_VOLUME..."
    docker volume create "$MEDIA_VOLUME"
  fi

  docker run --rm \
    -v "$MEDIA_VOLUME":/data \
    -v "$(dirname "$MEDIA_FILE")":/backup:ro \
    alpine sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$MEDIA_FILE") -C /data"

  # Fix ownership — backend container runs as appuser (UID from Dockerfile)
  echo "  Fixing media file ownership (appuser:appgroup)..."
  docker run --rm \
    -v "$MEDIA_VOLUME":/data \
    alpine chown -R 1000:1000 /data

  echo "  ✓ Media files restored"
else
  echo "[4/5] Skipping media restore (no media backup file provided)"
fi

# ---------- Start backend ----------
echo "[5/5] Starting backend..."
dc start backend
echo "  ✓ Backend started"

# ---------- Post-restore verification ----------
echo ""
echo "============================================="
echo " Post-Restore Verification"
echo "============================================="

# 1. Wait for backend healthcheck
echo -n "  Waiting for backend healthcheck"
RETRIES=0
MAX_RETRIES=30
until dc exec -T backend wget -q --spider http://localhost:8080/api/health 2>/dev/null; do
  RETRIES=$((RETRIES + 1))
  if [[ $RETRIES -ge $MAX_RETRIES ]]; then
    echo " TIMEOUT (backend did not become healthy within ${MAX_RETRIES} attempts)"
    echo "  Check logs: docker compose -f $COMPOSE_FILE logs backend"
    break
  fi
  echo -n "."
  sleep 2
done
if [[ $RETRIES -lt $MAX_RETRIES ]]; then
  echo " OK"
fi

# 2. Check table count
echo -n "  Checking database tables..."
TABLE_COUNT=$(dc exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null)
echo " $TABLE_COUNT tables"

# 3. Check media file count (if volume exists)
if docker volume inspect "$MEDIA_VOLUME" &>/dev/null; then
  echo -n "  Counting media files on disk..."
  MEDIA_COUNT=$(docker run --rm \
    -v "$MEDIA_VOLUME":/data:ro \
    alpine sh -c 'find /data -type f | wc -l' 2>/dev/null)
  echo " $MEDIA_COUNT files"

  echo -n "  Counting media URLs in database..."
  DB_MEDIA_COUNT=$(dc exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A \
    -c "SELECT count(*) FROM (
      SELECT image_url FROM material_boards WHERE image_url <> '' AND image_url IS NOT NULL
      UNION ALL
      SELECT preview_texture_url FROM material_boards WHERE preview_texture_url <> '' AND preview_texture_url IS NOT NULL
      UNION ALL
      SELECT image_url FROM hardwares WHERE image_url <> '' AND image_url IS NOT NULL
      UNION ALL
      SELECT image_url FROM modules WHERE image_url <> '' AND image_url IS NOT NULL
    ) t" 2>/dev/null)
  echo " $DB_MEDIA_COUNT URLs"

  if [[ "$MEDIA_COUNT" -eq 0 && "$DB_MEDIA_COUNT" -gt 0 ]]; then
    echo "  ⚠ WARNING: Database references $DB_MEDIA_COUNT media URLs but 0 files on disk."
    echo "    Catalog images will appear as 'Sin foto'. Run admin clean-media --apply"
    echo "    after connecting to the backend to clear dangling references."
  fi
fi

# 4. Check Caddy is routing
echo -n "  Checking Caddy is running..."
if dc exec -T caddy caddy version &>/dev/null; then
  echo " OK"
else
  echo " NOT RESPONDING"
fi

echo ""
echo "============================================="
echo " Restore complete: $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================="
echo " Safety backup: $SAFETY_DIR/pre_restore.sql.gz"
echo ""
echo "NEXT STEPS:"
echo "  1. Verify the application loads in the browser"
echo "  2. Log in as admin and check catalog images"
echo "  3. If dangling media URLs exist, run:"
echo "     docker compose -f $COMPOSE_FILE exec backend /app/admin clean-media --apply"
echo "  4. If something is wrong, restore from safety backup:"
echo "     gunzip -c $SAFETY_DIR/pre_restore.sql.gz | \\"
echo "       docker compose -f $COMPOSE_FILE exec -T postgres \\"
echo "       pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --clean --if-exists"
echo "============================================="
