#!/usr/bin/env bash
# pilot-gate.sh — Pilot / Multi-Org Readiness Gate (F179)
#
# OBLIGATORIO antes de cualquier deploy a una instalación con talleres
# piloto. Ver docs/pilot-readiness.md.
#
# Demuestra, contra PostgreSQL real y sin mocks, que dos organizaciones
# independientes (los fixtures conceptuales pilot-a / pilot-b) coexisten sin
# fuga de datos y que las operaciones reales básicas se conservan. En modo
# gate los skips están prohibidos: sin base de datos el script FALLA — un
# verde falso no puede abrir el deploy.
#
# Uso:
#   DATABASE_URL=postgres://granete_app:… MIGRATION_DATABASE_URL=postgres://admin:… scripts/pilot-gate.sh
#   scripts/pilot-gate.sh --fresh-container    # postgres efímero vía docker, cero dependencias locales
#
# El modo externo requiere ambas URLs: runtime usa granete_app y migraciones
# usan autoridad administrativa. --dsn único ya no es seguro y falla cerrado.
#
# Requisitos: go >= 1.25 y una base PostgreSQL alcanzable. Con
# postgresql-client instalado corre además la pata de backup/restore
# (pg_dump/pg_restore); sin ella esa pata se salta con un aviso explícito.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE_CONTAINER=""
RUNTIME_DSN="${DATABASE_URL:-}"
MIGRATION_DSN="${MIGRATION_DATABASE_URL:-}"
SINGLE_DSN=""

usage() {
  grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -20
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dsn)
      [ $# -ge 2 ] || usage
      SINGLE_DSN="$2"
      shift 2
      ;;
    --fresh-container)
      GATE_CONTAINER=1
      shift
      ;;
    *)
      usage
      ;;
  esac
done

CONTAINER_NAME="granete-pilot-gate"
CONTAINER_PORT="5545"

cleanup_container() {
  if [ -n "$(docker ps -q -f name="${CONTAINER_NAME}" 2>/dev/null || true)" ]; then
    echo "[pilot-gate] deteniendo postgres efímero (${CONTAINER_NAME})"
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
}

if [ -n "${SINGLE_DSN}" ]; then
  echo "[pilot-gate] --dsn único no puede separar autoridad de migración y runtime; use DATABASE_URL y MIGRATION_DATABASE_URL explícitos" >&2
  exit 1
fi

if [ -z "${RUNTIME_DSN}" ] && [ -z "${MIGRATION_DSN}" ] && [ -z "${GATE_CONTAINER}" ]; then
  echo "[pilot-gate] sin URLs separadas; seleccionando contenedor postgres efímero automáticamente (--fresh-container)"
  GATE_CONTAINER=1
fi

if [ -n "${GATE_CONTAINER}" ]; then
  command -v docker >/dev/null 2>&1 || {
    echo "[pilot-gate] --fresh-container requiere docker" >&2
    exit 1
  }
  command -v openssl >/dev/null 2>&1 || {
    echo "[pilot-gate] --fresh-container requiere openssl para credenciales efímeras" >&2
    exit 1
  }
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  APP_DATABASE_PASSWORD="$(openssl rand -hex 24)"
  echo "[pilot-gate] levantando postgres efímero (postgres:16-alpine, puerto ${CONTAINER_PORT})"
  trap cleanup_container EXIT
  docker run -d --rm --name "${CONTAINER_NAME}" \
    -e POSTGRES_DB=postgres \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
    -e APP_DATABASE_PASSWORD="${APP_DATABASE_PASSWORD}" \
    -v "${ROOT}/scripts/postgres-init-app-role.sh:/docker-entrypoint-initdb.d/10-app-role.sh:ro" \
    -p "${CONTAINER_PORT}:5432" \
    postgres:16-alpine >/dev/null
  MIGRATION_DSN="postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${CONTAINER_PORT}/postgres?sslmode=disable"
  RUNTIME_DSN="postgres://granete_app:${APP_DATABASE_PASSWORD}@127.0.0.1:${CONTAINER_PORT}/muebles_pilot_readiness?sslmode=disable"
  # Readiness must hold on BOTH the init-complete log line and a TCP
  # pg_isready: the official image's temporary init server answers socket
  # probes before the real server starts (and then stops), which made the
  # old probe report "listo" and the immediate re-check fail ~60ms later
  # (CI flake, also seen on main). Same hardening as
  # organization-browser-gate.sh: track the loop's own success instead of
  # re-probing after the loop.
  postgres_ready() {
    docker logs "${CONTAINER_NAME}" 2>&1 | grep -Fq 'PostgreSQL init process complete; ready for start up.' &&
      docker exec "${CONTAINER_NAME}" pg_isready -U postgres -h 127.0.0.1 -p 5432 >/dev/null 2>&1
  }
  echo -n "[pilot-gate] esperando postgres"
  POSTGRES_READY=""
  for _ in $(seq 1 60); do
    if postgres_ready; then
      POSTGRES_READY=yes
      echo " listo"
      break
    fi
    echo -n "."
    sleep 1
  done
  echo
  if [ -z "${POSTGRES_READY}" ]; then
    echo "[pilot-gate] PostgreSQL container log (diagnostics):" >&2
    docker logs "${CONTAINER_NAME}" 2>&1 | tail -20 >&2
    echo "[pilot-gate] el postgres efímero nunca quedó listo" >&2
    exit 1
  fi
fi

command -v go >/dev/null 2>&1 || {
  echo "[pilot-gate] go no está instalado (requerido por la suite)" >&2
  exit 1
}

# External mode must receive explicit, already-separated authorities. A
# single DSN would give the runtime administrative rights or force the gate to
# infer credentials, both of which violate the test-database authority model.
if [ -z "${GATE_CONTAINER}" ]; then
  if [ -z "${RUNTIME_DSN}" ] || [ -z "${MIGRATION_DSN}" ]; then
    echo "[pilot-gate] modo externo requiere DATABASE_URL runtime y MIGRATION_DATABASE_URL administrativa" >&2
    exit 1
  fi
  echo "[pilot-gate] validando URLs externas separadas de runtime y migración..."
  python3 - "${RUNTIME_DSN}" "${MIGRATION_DSN}" <<'PY_VALIDATE' || {
import sys
from urllib.parse import urlparse

runtime_dsn, migration_dsn = (value.strip() for value in sys.argv[1:3])
if not runtime_dsn or not migration_dsn or runtime_dsn == migration_dsn:
    sys.stderr.write("[pilot-gate] URLs externas vacías o no separadas\n")
    sys.exit(1)

def parse(label, dsn):
    try:
        parsed = urlparse(dsn)
    except Exception as exc:
        sys.stderr.write(f"[pilot-gate] {label} DSN no parseable: {exc}\n")
        sys.exit(1)
    path = parsed.path.lstrip("/").split("?")[0].strip().lower()
    host = (parsed.hostname or "").lower()
    if not path or path == "muebles" or "prod" in path or "prod" in host:
        sys.stderr.write(f"[pilot-gate] {label} DSN externo rechazado: host={host} db={path}\n")
        sys.exit(1)
    return parsed, path

runtime, runtime_db = parse("runtime", runtime_dsn)
migration, migration_db = parse("migración", migration_dsn)
allowed_exact = {"postgres", "granete_gate", "granete_test", "muebles_multiorg_test", "muebles_pilot_readiness"}
allowed_prefixes = ("granete_test_", "granete_gate_", "muebles_multiorg_test_", "muebles_pilot_", "hwassets_api_e2e_")
def allowed(name):
    return name in allowed_exact or any(name.startswith(prefix) for prefix in allowed_prefixes)

if not allowed(runtime_db) or not allowed(migration_db):
    sys.stderr.write("[pilot-gate] URLs externas deben apuntar a bases de test permitidas\n")
    sys.exit(1)
if runtime.username != "granete_app":
    sys.stderr.write("[pilot-gate] DATABASE_URL externa debe usar el rol runtime granete_app\n")
    sys.exit(1)
if runtime_db == "postgres":
    sys.stderr.write("[pilot-gate] DATABASE_URL externa no puede usar /postgres\n")
    sys.exit(1)
PY_VALIDATE
    echo "[pilot-gate] ❌ URLs externas inválidas o inseguras. Abortando antes de emitir queries." >&2
    exit 1
  }
fi

if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
  echo "[pilot-gate] AVISO: pg_dump/pg_restore no están en PATH — la pata de"
  echo "[pilot-gate] backup/restore se saltará (instalá postgresql-client para el gate completo)."
fi

echo "[pilot-gate] corriendo la suite de Pilot Readiness (base de test efímera,"
echo "[pilot-gate] nunca toca datos productivos) con runtime granete_app y migración administrativa (${GATE_CONTAINER:-externa})"

cd "${ROOT}/backend-go"
echo "[pilot-gate] verificando RLS directo con credenciales runtime sin privilegios"
STORAGE_PATTERN="${PILOT_GATE_STORAGE_PATTERN:-^TestTenantRLS_}"
if [ "${PILOT_GATE_FOUNDATION_A:-}" = "1" ] && [ -z "${PILOT_GATE_STORAGE_PATTERN:-}" ]; then
  STORAGE_PATTERN='^(TestTenantRLS_|TestGateAProvisioning|TestOrganizationLifecycleMigration_BackfillsCanonicalStatusAndEntitlements|TestOrganizationLifecycleMigration_NormalizesHistoricalPartialFixture|TestPlatformLifecycleHTTPPostgresInheritedRuntimeRole|TestSecurityAuditEnvelope)'
  echo "[pilot-gate] incluyendo fresh/upgrade y provisioning atomic de Foundation Gate A"
fi
MIGRATION_DATABASE_URL="${MIGRATION_DSN}" DATABASE_URL="${RUNTIME_DSN}" GRANETE_TEST_DATABASE=1 GOFLAGS='-p=1' go test ./internal/storage -run "${STORAGE_PATTERN}" -v -count=1

if MIGRATION_DATABASE_URL="${MIGRATION_DSN}" DATABASE_URL="${RUNTIME_DSN}" GRANETE_TEST_DATABASE=1 PILOT_READINESS_GATE=1 \
  GOFLAGS='-p=1' go test ./tests/pilotreadiness/ -v -count=1; then
  echo ""
  echo "[pilot-gate] ✅ Pilot Readiness PASS — el aislamiento multi-org está verificado."
else
  echo ""
  echo "[pilot-gate] ❌ Pilot Readiness FAIL — NO desplegar. Un regression de"
  echo "[pilot-gate] aislamiento o de operaciones básicas hace fallar el gate."
  exit 1
fi
