#!/usr/bin/env bash
# scripts/backend-test.sh — Canonical Go backend test runner with test DB isolation (#823)
#
# Spawns an ephemeral PostgreSQL container with no persistent volumes,
# initializes the granete_app runtime role, exports test environment variables
# (GRANETE_TEST_DATABASE=1, DATABASE_URL, MIGRATION_DATABASE_URL), runs go test,
# and cleans up all temporary resources via trap on exit.
#
# Usage:
#   scripts/backend-test.sh [go test args...]
# Examples:
#   scripts/backend-test.sh ./...
#   scripts/backend-test.sh -run TestStructureRevision -v ./internal/storage

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/granete-backend-test.XXXXXX")"
CONTAINER=""
RUN_STARTED_SECONDS="$(date +%s)"

cleanup() {
  if [ -n "${CONTAINER}" ]; then
    docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  fi
  rm -rf "${TMP_ROOT}"
  unset POSTGRES_PASSWORD APP_DATABASE_PASSWORD DATABASE_URL MIGRATION_DATABASE_URL GRANETE_TEST_DATABASE
}
trap cleanup EXIT INT TERM

fail() {
  printf '[backend-test] FAIL: %s\n' "$1" >&2
  exit 1
}

for command in docker go python3 openssl; do
  command -v "${command}" >/dev/null 2>&1 || fail "${command} is required"
done

docker info >/dev/null 2>&1 || fail "Docker is not available"

CONTAINER="granete-backend-test-$$-$(openssl rand -hex 4)"
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
APP_DATABASE_PASSWORD="$(openssl rand -hex 24)"

free_port() {
  python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
}

POSTGRES_PORT="$(free_port)"

# Start ephemeral PostgreSQL container (NO persistent volume mounted)
docker run -d --rm --name "${CONTAINER}" \
  -e POSTGRES_DB=granete_test \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  -e APP_DATABASE_PASSWORD="${APP_DATABASE_PASSWORD}" \
  -v "${ROOT}/scripts/postgres-init-app-role.sh:/docker-entrypoint-initdb.d/10-app-role.sh:ro" \
  -p "127.0.0.1:${POSTGRES_PORT}:5432" \
  postgres:16-alpine >/dev/null

postgres_ready() {
  docker logs "${CONTAINER}" 2>&1 | grep -Fq 'PostgreSQL init process complete; ready for start up.' &&
    docker exec "${CONTAINER}" pg_isready -U postgres -d granete_test >/dev/null 2>&1
}

POSTGRES_READY=""
for _ in $(seq 1 60); do
  if postgres_ready; then
    POSTGRES_READY=yes
    break
  fi
  sleep 1
done

if [ -z "${POSTGRES_READY}" ]; then
  echo "[backend-test] PostgreSQL container log (diagnostics):" >&2
  docker logs "${CONTAINER}" 2>&1 | tail -20 >&2
  fail "PostgreSQL did not become ready"
fi

POSTGRES_READY_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
POSTGRES_SETUP_SECONDS="$(( $(date +%s) - RUN_STARTED_SECONDS ))"
printf '[backend-test] postgres-ready=%s postgres-setup-duration=%ss\n' "${POSTGRES_READY_AT}" "${POSTGRES_SETUP_SECONDS}" >&2

MIGRATION_DATABASE_URL="postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/granete_test?sslmode=disable"
APP_DATABASE_URL="postgres://granete_app:${APP_DATABASE_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/granete_test?sslmode=disable"
# Runtime tests must use the real unprivileged application role. Migration setup
# remains explicitly privileged, satisfying the #823 role-separation contract.
DATABASE_URL="${APP_DATABASE_URL}"

export DATABASE_URL MIGRATION_DATABASE_URL APP_DATABASE_URL
export GRANETE_TEST_DATABASE=1

cd "${ROOT}/backend-go"

# Run tests with package serialization (-p 1) and process serialization (-parallel 1)
# to ensure cluster-global DDL/roles and migrations do not conflict.
# Reject any explicit -p or -parallel values other than 1.
HAS_P=0
HAS_PARALLEL=0

i=1
while [ $i -le $# ]; do
  arg="${!i}"
  case "${arg}" in
    -p|--p)
      j=$((i + 1))
      if [ $j -le $# ]; then
        val="${!j}"
        if [ "${val}" != "1" ]; then
          fail "insecure package concurrency: ${arg} ${val}. Automated tests must run with -p 1."
        fi
        HAS_P=1
      fi
      ;;
    -p=*|--p=*)
      val="${arg#*=}"
      if [ "${val}" != "1" ]; then
        fail "insecure package concurrency: ${arg}. Automated tests must run with -p 1."
      fi
      HAS_P=1
      ;;
    -parallel|--parallel)
      j=$((i + 1))
      if [ $j -le $# ]; then
        val="${!j}"
        if [ "${val}" != "1" ]; then
          fail "insecure test process concurrency: ${arg} ${val}. Automated tests must run with -parallel 1."
        fi
        HAS_PARALLEL=1
      fi
      ;;
    -parallel=*|--parallel=*)
      val="${arg#*=}"
      if [ "${val}" != "1" ]; then
        fail "insecure test process concurrency: ${arg}. Automated tests must run with -parallel 1."
      fi
      HAS_PARALLEL=1
      ;;
  esac
  i=$((i + 1))
done

GO_ARGS=()
[ "${HAS_P}" -eq 0 ] && GO_ARGS+=("-p" "1")
[ "${HAS_PARALLEL}" -eq 0 ] && GO_ARGS+=("-parallel" "1")

TEST_STARTED_SECONDS="$(date +%s)"
set +e
if [ $# -gt 0 ]; then
  go test "${GO_ARGS[@]}" "$@"
  TEST_STATUS=$?
else
  go test "${GO_ARGS[@]}" -timeout=30m ./...
  TEST_STATUS=$?
fi
set -e
TEST_ELAPSED_SECONDS="$(( $(date +%s) - TEST_STARTED_SECONDS ))"
TOTAL_ELAPSED_SECONDS="$(( $(date +%s) - RUN_STARTED_SECONDS ))"
printf '[backend-test] test-duration=%ss total-duration=%ss finished=%s\n' \
  "${TEST_ELAPSED_SECONDS}" "${TOTAL_ELAPSED_SECONDS}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
exit "${TEST_STATUS}"
