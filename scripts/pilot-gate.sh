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
#   scripts/pilot-gate.sh                      # DATABASE_URL o docker compose dev (localhost:5445)
#   scripts/pilot-gate.sh --dsn postgres://…   # DSN explícito (staging, etc.)
#   scripts/pilot-gate.sh --fresh-container    # postgres efímero vía docker, cero dependencias locales
#
# Requisitos: go >= 1.25 y una base PostgreSQL alcanzable. Con
# postgresql-client instalado corre además la pata de backup/restore
# (pg_dump/pg_restore); sin ella esa pata se salta con un aviso explícito.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE_CONTAINER=""
DSN="${DATABASE_URL:-}"

usage() {
  grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -20
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dsn)
      [ $# -ge 2 ] || usage
      DSN="$2"
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

if [ -z "${DSN}" ]; then
  DSN="postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
fi

if [ -n "${GATE_CONTAINER}" ]; then
  command -v docker >/dev/null 2>&1 || {
    echo "[pilot-gate] --fresh-container requiere docker" >&2
    exit 1
  }
  echo "[pilot-gate] levantando postgres efímero (postgres:16-alpine, puerto ${CONTAINER_PORT})"
  trap cleanup_container EXIT
  docker run -d --rm --name "${CONTAINER_NAME}" \
    -e POSTGRES_PASSWORD=postgres -p "${CONTAINER_PORT}:5432" \
    postgres:16-alpine >/dev/null
  DSN="postgres://postgres:postgres@localhost:${CONTAINER_PORT}/postgres?sslmode=disable"
  echo -n "[pilot-gate] esperando postgres"
  for _ in $(seq 1 30); do
    if docker exec "${CONTAINER_NAME}" pg_isready -U postgres >/dev/null 2>&1; then
      echo " listo"
      break
    fi
    echo -n "."
    sleep 1
  done
  echo
  docker exec "${CONTAINER_NAME}" pg_isready -U postgres >/dev/null 2>&1 || {
    echo "[pilot-gate] el postgres efímero nunca quedó listo" >&2
    exit 1
  }
fi

command -v go >/dev/null 2>&1 || {
  echo "[pilot-gate] go no está instalado (requerido por la suite)" >&2
  exit 1
}

if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
  echo "[pilot-gate] AVISO: pg_dump/pg_restore no están en PATH — la pata de"
  echo "[pilot-gate] backup/restore se saltará (instalá postgresql-client para el gate completo)."
fi

echo "[pilot-gate] corriendo la suite de Pilot Readiness (base de test efímera,"
echo "[pilot-gate] nunca toca datos productivos) con DATABASE_URL del entorno/${GATE_CONTAINER:-dev}"

cd "${ROOT}/backend-go"
if DATABASE_URL="${DSN}" PILOT_READINESS_GATE=1 \
  go test ./tests/pilotreadiness/ -v -count=1; then
  echo ""
  echo "[pilot-gate] ✅ Pilot Readiness PASS — el aislamiento multi-org está verificado."
else
  echo ""
  echo "[pilot-gate] ❌ Pilot Readiness FAIL — NO desplegar. Un regression de"
  echo "[pilot-gate] aislamiento o de operaciones básicas hace fallar el gate."
  exit 1
fi
