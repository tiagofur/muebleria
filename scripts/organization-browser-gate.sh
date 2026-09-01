#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/granete-organization-gate.XXXXXX")"
CONTAINER=""
BACKEND_PID=""

cleanup() {
  if [ -n "${BACKEND_PID}" ]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
    wait "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  rm -rf "${TMP_ROOT}"
  unset POSTGRES_PASSWORD APP_DATABASE_PASSWORD JWT_SECRET REFRESH_TOKEN_PEPPER MEDIA_SIGNING_KEY ADMIN_PASSWORD
}
trap cleanup EXIT INT TERM

fail() {
  printf '[organization-gate] FAIL: %s\n' "$1" >&2
  exit 1
}

for command in docker go pnpm curl openssl python3; do
  command -v "${command}" >/dev/null 2>&1 || fail "${command} is required"
done
docker info >/dev/null 2>&1 || fail "Docker is not available"
CONTAINER="granete-org-gate-$$-$(openssl rand -hex 4)"

free_port() {
  python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
}

POSTGRES_PASSWORD="$(openssl rand -hex 32)"
APP_DATABASE_PASSWORD="$(openssl rand -hex 32)"
JWT_SECRET="$(openssl rand -hex 48)"
REFRESH_TOKEN_PEPPER="$(openssl rand -hex 48)"
MEDIA_SIGNING_KEY="$(openssl rand -hex 48)"
ADMIN_PASSWORD="Gate-$(openssl rand -hex 24)-7a"
BACKEND_PORT="$(free_port)"
ORGANIZATION_WEB_PORT="$(free_port)"
while [ "${ORGANIZATION_WEB_PORT}" = "${BACKEND_PORT}" ]; do
  ORGANIZATION_WEB_PORT="$(free_port)"
done
ORGANIZATION_GATE_EMAIL="browser-gate@example.com"
ORGANIZATION_GATE_A_OWNER_EMAIL="browser-gate-a-owner@example.com"
ORGANIZATION_GATE_B_OWNER_EMAIL="browser-gate-b-owner@example.com"
MEDIA_DIR="${TMP_ROOT}/media"
mkdir -p "${MEDIA_DIR}"

docker run -d --rm --name "${CONTAINER}" \
  -e POSTGRES_DB=granete_gate \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  -e APP_DATABASE_PASSWORD="${APP_DATABASE_PASSWORD}" \
  -v "${ROOT}/scripts/postgres-init-app-role.sh:/docker-entrypoint-initdb.d/10-app-role.sh:ro" \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null

for _ in $(seq 1 60); do
  docker logs "${CONTAINER}" 2>&1 | grep -Fq 'PostgreSQL init process complete; ready for start up.' && docker exec "${CONTAINER}" pg_isready -U postgres -d granete_gate >/dev/null 2>&1 && break
  sleep 1
done
if ! docker logs "${CONTAINER}" 2>&1 | grep -Fq 'PostgreSQL init process complete; ready for start up.' || ! docker exec "${CONTAINER}" pg_isready -U postgres -d granete_gate >/dev/null 2>&1; then
  fail "PostgreSQL did not become ready"
fi

POSTGRES_PORT="$(docker inspect -f '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "${CONTAINER}")"
MIGRATION_DATABASE_URL="postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/granete_gate?sslmode=disable"
DATABASE_URL="postgres://granete_app:${APP_DATABASE_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/granete_gate?sslmode=disable"

ROLE_FLAGS="$(docker exec "${CONTAINER}" psql -At -U postgres -d granete_gate \
  -c "SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'granete_app'")"
[ "${ROLE_FLAGS}" = 't|f|f' ] || fail "runtime role must be LOGIN, NOSUPERUSER, NOBYPASSRLS"

export DATABASE_URL MIGRATION_DATABASE_URL JWT_SECRET REFRESH_TOKEN_PEPPER MEDIA_SIGNING_KEY MEDIA_DIR ADMIN_PASSWORD
export PORT="${BACKEND_PORT}"
export CORS_ALLOWED_ORIGINS="http://127.0.0.1:${ORGANIZATION_WEB_PORT}"
export RATE_LIMIT_RPS=100 RATE_LIMIT_BURST=100

(cd "${ROOT}/backend-go" && go run ./cmd/server >"${TMP_ROOT}/backend.log" 2>&1) &
BACKEND_PID=$!
for _ in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1 && break
  kill -0 "${BACKEND_PID}" >/dev/null 2>&1 || {
    fail "backend exited before health readiness"
  }
  sleep 1
done
curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null \
  || fail "backend health endpoint did not become ready"

(cd "${ROOT}/backend-go" && go run ./cmd/admin create \
  --email "${ORGANIZATION_GATE_A_OWNER_EMAIL}" --name "Browser Gate A Owner") >/dev/null
(cd "${ROOT}/backend-go" && go run ./cmd/admin create \
  --email "${ORGANIZATION_GATE_B_OWNER_EMAIL}" --name "Browser Gate B Owner") >/dev/null
(cd "${ROOT}/backend-go" && go run ./cmd/admin create-platform-admin \
  --email "${ORGANIZATION_GATE_A_OWNER_EMAIL}") >/dev/null
(cd "${ROOT}/backend-go" && go run ./cmd/admin create-org \
  --name "Browser Gate A" --slug browser-gate-a --type factory \
  --admin-email "${ORGANIZATION_GATE_A_OWNER_EMAIL}" \
  --idempotency-key browser-gate-a-bootstrap --license trial) >/dev/null
(cd "${ROOT}/backend-go" && go run ./cmd/admin create-org \
  --name "Browser Gate B" --slug browser-gate-b --type factory \
  --admin-email "${ORGANIZATION_GATE_B_OWNER_EMAIL}" \
  --idempotency-key browser-gate-b-bootstrap --license pro) >/dev/null
# #460 SEC-3: canonical server media names (32 hex chars), placed under each
# organization's partition like the real upload endpoint does — the browser
# gate then exercises the signed-grant media flow end to end.
ORG_A_MEDIA_ID="$(docker exec "${CONTAINER}" psql -At -U postgres -d granete_gate -c "SELECT id FROM organizations WHERE slug='browser-gate-a'")"
ORG_B_MEDIA_ID="$(docker exec "${CONTAINER}" psql -At -U postgres -d granete_gate -c "SELECT id FROM organizations WHERE slug='browser-gate-b'")"
python3 - "${MEDIA_DIR}" "${ORG_A_MEDIA_ID}" "${ORG_B_MEDIA_ID}" <<'PY'
import base64, pathlib, sys
root, org_a, org_b = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
for org, name, data in (
    (org_a, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
    (org_b, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8zwAAAgEBAScY42YAAAAASUVORK5CYII='),
):
    (root / org).mkdir(parents=True, exist_ok=True)
    (root / org / name).write_bytes(base64.b64decode(data))
PY

export ORGANIZATION_WEB_PORT ORGANIZATION_GATE_EMAIL
export ORGANIZATION_GATE_A_OWNER_EMAIL ORGANIZATION_GATE_B_OWNER_EMAIL
export ORGANIZATION_GATE_ORG_A_SLUG=browser-gate-a
export ORGANIZATION_GATE_ORG_B_SLUG=browser-gate-b
export ORGANIZATION_GATE_ORG_SLUG=browser-gate-a
export ORGANIZATION_GATE_PASSWORD="${ADMIN_PASSWORD}"
export ORGANIZATION_API_BASE="http://127.0.0.1:${BACKEND_PORT}/api"
export VITE_API_BASE="${ORGANIZATION_API_BASE}"
export ORGANIZATION_TEST_OUTPUT="${TMP_ROOT}/playwright-output"

cd "${ROOT}"
pnpm exec playwright test --config=playwright.organization.config.ts "$@"
printf '[organization-gate] PASS\n'
