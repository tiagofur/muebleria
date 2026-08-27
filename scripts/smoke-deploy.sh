#!/usr/bin/env bash
# =============================================================================
# Granete — Deployment Smoke Test
# =============================================================================
# Validates that compose, env template, scripts, and docs are structurally
# consistent. Run this after any infrastructure change to catch drift.
#
# Usage:
#   scripts/smoke-deploy.sh
#
# Exit code 0 = all checks pass. Non-zero = something is broken.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }

echo "========================================"
echo " Granete Deployment Smoke Test"
echo "========================================"
echo ""

# ---------- 1. Compose file parses ----------
echo "[1] docker-compose.prod.yml parses correctly"
if POSTGRES_PASSWORD=test JWT_SECRET=testsecret1234567890123456789012345678 \
  docker compose -f "$PROJECT_DIR/docker-compose.prod.yml" config &>/dev/null; then
  pass "Compose config validates"
else
  fail "Compose config FAILS to validate"
fi

# ---------- 2. Required env vars in .env.production.example ----------
echo ""
echo "[2] .env.production.example contains required variables"
ENV_FILE="$PROJECT_DIR/.env.production.example"
if [[ ! -f "$ENV_FILE" ]]; then
  fail ".env.production.example does not exist"
else
  REQUIRED_VARS="DOMAIN POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB JWT_SECRET CORS_ALLOWED_ORIGINS"
  for var in $REQUIRED_VARS; do
    if grep -q "^${var}=" "$ENV_FILE"; then
      pass "Variable $var is defined"
    else
      fail "Variable $var is MISSING from .env.production.example"
    fi
  done
fi

# ---------- 3. /api/health endpoint exists in routes ----------
echo ""
echo "[3] Health endpoint is registered"
ROUTES_FILE="$PROJECT_DIR/backend-go/internal/api/routes.go"
if grep -q '/api/health' "$ROUTES_FILE"; then
  pass "/api/health endpoint is registered in routes.go"
else
  fail "/api/health endpoint is MISSING from routes.go"
fi

# ---------- 4. Healthcheck in compose matches actual endpoint ----------
echo ""
echo "[4] Compose healthcheck matches real endpoint"
if grep -q '/api/health' "$PROJECT_DIR/docker-compose.prod.yml"; then
  pass "Compose healthcheck points to /api/health"
else
  fail "Compose healthcheck does NOT reference /api/health"
fi
if grep -q '/api/health' "$PROJECT_DIR/backend-go/Dockerfile"; then
  pass "Dockerfile healthcheck points to /api/health"
else
  fail "Dockerfile healthcheck does NOT reference /api/health"
fi

# ---------- 5. Admin CLI in docs uses correct flags ----------
echo ""
echo "[5] Admin CLI documentation uses valid commands"
DEPLOY_DOC="$PROJECT_DIR/docs/deployment.md"
if [[ -f "$DEPLOY_DOC" ]]; then
  # The create subcommand should NOT have --role or --platform-admin
  if grep -q 'create.*--role.*--platform-admin' "$DEPLOY_DOC"; then
    fail "docs/deployment.md uses invalid 'create --role --platform-admin' (should be two steps)"
  else
    pass "Admin CLI flags in deployment.md look correct"
  fi
  # Should reference create-platform-admin
  if grep -q 'create-platform-admin' "$DEPLOY_DOC"; then
    pass "docs/deployment.md references create-platform-admin"
  else
    fail "docs/deployment.md does NOT reference create-platform-admin"
  fi
else
  fail "docs/deployment.md not found"
fi

# ---------- 6. Backup script references media ----------
echo ""
echo "[6] Backup covers both PostgreSQL AND media"
BACKUP_SCRIPT="$PROJECT_DIR/scripts/backup.sh"
if [[ -f "$BACKUP_SCRIPT" ]]; then
  if grep -q 'pg_dump' "$BACKUP_SCRIPT" && grep -q 'media' "$BACKUP_SCRIPT"; then
    pass "backup.sh covers both DB and media"
  else
    fail "backup.sh is missing DB or media backup"
  fi
else
  fail "scripts/backup.sh not found"
fi

# ---------- 7. Restore script covers media ----------
echo ""
echo "[7] Restore covers both PostgreSQL AND media"
RESTORE_SCRIPT="$PROJECT_DIR/scripts/restore.sh"
if [[ -f "$RESTORE_SCRIPT" ]]; then
  if grep -q 'pg_restore' "$RESTORE_SCRIPT" && grep -q 'media' "$RESTORE_SCRIPT"; then
    pass "restore.sh covers both DB and media"
  else
    fail "restore.sh is missing DB or media restore"
  fi
else
  fail "scripts/restore.sh not found"
fi

# ---------- 8. Scripts are executable ----------
echo ""
echo "[8] Scripts are executable"
for script in scripts/backup.sh scripts/restore.sh scripts/smoke-deploy.sh; do
  FULL="$PROJECT_DIR/$script"
  if [[ -f "$FULL" && -x "$FULL" ]]; then
    pass "$script is executable"
  else
    fail "$script is missing or not executable"
  fi
done

# ---------- 9. Bash syntax check ----------
echo ""
echo "[9] Bash syntax validation"
for script in scripts/backup.sh scripts/restore.sh scripts/smoke-deploy.sh; do
  FULL="$PROJECT_DIR/$script"
  if [[ -f "$FULL" ]] && bash -n "$FULL" 2>/dev/null; then
    pass "$script has valid bash syntax"
  else
    fail "$script has a SYNTAX ERROR"
  fi
done

# ---------- 10. Scripts use set -euo pipefail ----------
echo ""
echo "[10] Scripts use strict mode"
for script in scripts/backup.sh scripts/restore.sh; do
  FULL="$PROJECT_DIR/$script"
  if grep -q 'set -euo pipefail' "$FULL"; then
    pass "$script uses set -euo pipefail"
  else
    fail "$script does NOT use set -euo pipefail"
  fi
done

# ---------- 11. Offsite recommendation exists ----------
echo ""
echo "[11] Offsite backup recommendation documented"
if grep -qi 'offsite\|rsync\|s3' "$DEPLOY_DOC" 2>/dev/null; then
  pass "deployment.md mentions offsite backup strategy"
else
  fail "deployment.md does NOT mention offsite backup"
fi

# ---------- 12. Rollback procedure documented ----------
echo ""
echo "[12] Rollback procedure documented"
if grep -qi 'rollback' "$DEPLOY_DOC" 2>/dev/null; then
  pass "deployment.md documents rollback procedure"
else
  fail "deployment.md does NOT document rollback"
fi

# ---------- 13. Volume names in compose match scripts ----------
echo ""
echo "[13] Volume names are consistent"
COMPOSE_VOLUMES=$(grep -oE 'granete_[a-zA-Z0-9_]*' "$PROJECT_DIR/docker-compose.prod.yml" | sort -u)
for v in granete_media_data granete_postgres_data; do
  if echo "$COMPOSE_VOLUMES" | grep -q "$v"; then
    pass "Volume $v defined in compose"
  else
    fail "Volume $v NOT found in compose"
  fi
done
if grep -q "granete_media_data" "$BACKUP_SCRIPT" 2>/dev/null; then
  pass "backup.sh references correct volume name"
else
  fail "backup.sh does NOT reference granete_media_data"
fi

# ---------- Summary ----------
echo ""
echo "========================================"
echo " Results: ${PASS} passed, ${FAIL} failed"
echo "========================================"
if [[ $FAIL -gt 0 ]]; then
  echo " ❌ Some checks failed. Fix the issues above."
  exit 1
else
  echo " ✅ All checks passed."
  exit 0
fi
