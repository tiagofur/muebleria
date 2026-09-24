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
  if [ -n "${PTX_DIAGNOSTIC_DIR:-}" ]; then
    mkdir -p "${PTX_DIAGNOSTIC_DIR}"
    find "${TMP_ROOT}/playwright-output" -type f \
      \( -name 'ptx-events.json' -o -name 'ptx-raw-trace.zip' -o -name 'ptx-screenshot.png' \) \
      -exec cp '{}' "${PTX_DIAGNOSTIC_DIR}/" \; 2>/dev/null || true
  fi
  rm -rf "${TMP_ROOT}"
  unset POSTGRES_PASSWORD APP_DATABASE_PASSWORD JWT_SECRET REFRESH_TOKEN_PEPPER MEDIA_SIGNING_KEY MFA_ENCRYPTION_KEY ADMIN_PASSWORD ORGANIZATION_TEST_DATABASE_URL
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fail() {
  printf '[organization-gate] FAIL: %s\n' "$1" >&2
  exit 1
}

PTX_BROWSER_MODE="${PTX_DIAGNOSTIC_BROWSER_ENV:-isolated}"
case "${PTX_BROWSER_MODE}" in
  isolated) ;;
  inherited-safe|ci+locale|ci|locale|linux)
    [ -n "${PTX_DIAGNOSTIC_DIR:-}" ] || fail "browser environment variant requires the temporary diagnostic harness"
    ;;
  *) fail "unknown temporary browser environment variant" ;;
esac

# Validate optional browser-only metadata before Docker or any writable child.
# A harmless key name alone does not make its ambient value safe to forward.
PTX_BROWSER_GROUP_NAMES=()
case "${PTX_BROWSER_MODE}" in
  ci+locale) PTX_BROWSER_GROUP_NAMES=(CI GITHUB_ACTIONS RUNNER_OS RUNNER_ARCH LANG LC_ALL LC_CTYPE LANGUAGE) ;;
  ci) PTX_BROWSER_GROUP_NAMES=(CI GITHUB_ACTIONS RUNNER_OS RUNNER_ARCH) ;;
  locale) PTX_BROWSER_GROUP_NAMES=(LANG LC_ALL LC_CTYPE LANGUAGE) ;;
  linux) PTX_BROWSER_GROUP_NAMES=(USER LOGNAME SHELL XDG_SESSION_TYPE XDG_CURRENT_DESKTOP) ;;
esac
locale_pattern='^(C(\.[A-Za-z0-9-]{1,12})?|POSIX|[a-z]{2,3}(_[A-Z]{2})?(\.[A-Za-z0-9-]{1,12})?(@[A-Za-z0-9_-]{1,24})?)$'
validate_browser_group_value() {
  local key="$1" value="$2" part upper
  # Never print the value: the reject path is itself an artifact boundary.
  upper="$(LC_ALL=C tr '[:lower:]' '[:upper:]' <<< "${value}")"
  case "${upper}" in
    *SECRET*|*TOKEN*|*PASSWORD*|*CREDENTIAL*|*BEARER*|*COOKIE*|*POSTGRES*|*MUEBLES*|*://*) return 1 ;;
  esac
  case "${key}" in
    CI|GITHUB_ACTIONS) [[ "${value}" = true || "${value}" = false ]] ;;
    RUNNER_OS) [[ "${value}" = Linux ]] ;;
    RUNNER_ARCH) [[ "${value}" = X64 ]] ;;
    LANG|LC_ALL|LC_CTYPE) [[ "${value}" =~ ${locale_pattern} ]] ;;
    LANGUAGE)
      [[ "${value}" != :* && "${value}" != *: && "${value}" != *::* ]] || return 1
      local parts=()
      IFS=: read -r -a parts <<< "${value}"
      for part in "${parts[@]}"; do [[ "${part}" =~ ${locale_pattern} ]] || return 1; done
      ;;
    USER|LOGNAME) [[ "${value}" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] ;;
    SHELL) [[ "${value}" = /bin/bash || "${value}" = /usr/bin/bash ]] ;;
    XDG_SESSION_TYPE) [[ "${value}" = tty || "${value}" = x11 || "${value}" = wayland || "${value}" = headless ]] ;;
    XDG_CURRENT_DESKTOP) [[ "${value}" = GNOME || "${value}" = KDE || "${value}" = XFCE || "${value}" = Unity || "${value}" = MATE || "${value}" = Cinnamon || "${value}" = LXQt || "${value}" = headless ]] ;;
    *) return 1 ;;
  esac
}
if [ "${PTX_BROWSER_MODE}" != isolated ] && [ "${PTX_BROWSER_MODE}" != inherited-safe ]; then
  for key in "${PTX_BROWSER_GROUP_NAMES[@]}"; do
    if [ "${!key+x}" = x ] && [ -n "${!key}" ]; then
      validate_browser_group_value "${key}" "${!key}" || fail "unsafe browser diagnostic value for ${key}"
    fi
  done
fi

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
MFA_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"
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
  --tmpfs /var/lib/postgresql/data:rw \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null

# 120 s (2x the previous window): the init-complete log line plus a real
# pg_isready must BOTH hold -- the init script creates the runtime role the
# migrations rely on. On failure the container log is printed so a flake is
# diagnosable instead of a bare "did not become ready".
postgres_ready() {
  docker logs "${CONTAINER}" 2>&1 | grep -Fq 'PostgreSQL init process complete; ready for start up.' &&
    docker exec "${CONTAINER}" pg_isready -U postgres -d granete_gate >/dev/null 2>&1
}
# Track the loop's own success instead of re-probing after the loop: a
# transient docker-exec/pg_isready failure in the immediate re-check would
# fail the gate even though the loop already observed both conditions hold
# (observed as a ~13% CI flake). The gate still fails hard if the loop never
# observes readiness.
POSTGRES_READY=""
for _ in $(seq 1 120); do
  if postgres_ready; then
    POSTGRES_READY=yes
    break
  fi
  sleep 1
done
if [ -z "${POSTGRES_READY}" ]; then
  echo "[organization-gate] PostgreSQL container log (diagnostics):" >&2
  docker logs "${CONTAINER}" 2>&1 | tail -20 >&2
  fail "PostgreSQL did not become ready"
fi

POSTGRES_BIND="$(docker inspect -f '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostIp}}:{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "${CONTAINER}")"
POSTGRES_HOST="${POSTGRES_BIND%:*}"
POSTGRES_PORT="${POSTGRES_BIND##*:}"
[ "${POSTGRES_HOST}" = '127.0.0.1' ] || fail "PostgreSQL must bind only to loopback"
MIGRATION_DATABASE_URL="postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/granete_gate?sslmode=disable"
DATABASE_URL="postgres://granete_app:${APP_DATABASE_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/granete_gate?sslmode=disable"
ORGANIZATION_TEST_DATABASE_URL="${MIGRATION_DATABASE_URL}"
ORGANIZATION_TEST_ISOLATED=1
GRANETE_TEST_DATABASE=1

# The same explicit, credential-bearing targets are validated without opening
# either connection before the server can migrate or any admin child can write.
# env -i prevents ambient DATABASE_URL, MIGRATION_DATABASE_URL, PG*, or production
# markers from replacing the freshly constructed disposable child environment.
GATE_BASE_ENV=(env -i
  PATH="${PATH}" HOME="${HOME:-/}" TMPDIR="${TMPDIR:-/tmp}"
  ORGANIZATION_TEST_ISOLATED="${ORGANIZATION_TEST_ISOLATED}"
  GRANETE_TEST_DATABASE="${GRANETE_TEST_DATABASE}"
  DATABASE_URL="${DATABASE_URL}"
  MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL}")
(cd "${ROOT}/backend-go" && "${GATE_BASE_ENV[@]}" \
  ORGANIZATION_GATE_POSTGRES_PORT="${POSTGRES_PORT}" \
  go run ./cmd/testdb-preflight) || fail "disposable database preflight rejected targets"
readonly DATABASE_URL MIGRATION_DATABASE_URL

ROLE_FLAGS="$(docker exec "${CONTAINER}" psql -At -U postgres -d granete_gate \
  -c "SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'granete_app'")"
[ "${ROLE_FLAGS}" = 't|f|f' ] || fail "runtime role must be LOGIN, NOSUPERUSER, NOBYPASSRLS"

# The marker belongs to this disposable database, not to a process env value.
# The backend later reads it through its runtime pool; Playwright reads it
# independently through the fixture connection before any setup write.
GATE_DB_MARKER="$(openssl rand -hex 32)"
docker exec "${CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d granete_gate \
  -c "ALTER DATABASE granete_gate SET granete.browser_gate_identity = '${GATE_DB_MARKER}'" >/dev/null \
  || fail "disposable database identity could not be established"
GATE_DB_IDENTITY_SHA256="$(python3 - "${GATE_DB_MARKER}" <<'PY'
import hashlib, sys
print(hashlib.sha256(sys.argv[1].encode()).hexdigest())
PY
)"
unset GATE_DB_MARKER

GATE_SERVER_ENV=("${GATE_BASE_ENV[@]}"
  JWT_SECRET="${JWT_SECRET}" REFRESH_TOKEN_PEPPER="${REFRESH_TOKEN_PEPPER}"
  MEDIA_SIGNING_KEY="${MEDIA_SIGNING_KEY}" MFA_ENCRYPTION_KEY="${MFA_ENCRYPTION_KEY}"
  MEDIA_DIR="${MEDIA_DIR}" PORT="${BACKEND_PORT}"
  CORS_ALLOWED_ORIGINS="http://127.0.0.1:${ORGANIZATION_WEB_PORT}"
  RATE_LIMIT_RPS=100 RATE_LIMIT_BURST=100)
GATE_ADMIN_ENV=("${GATE_BASE_ENV[@]}" ADMIN_PASSWORD="${ADMIN_PASSWORD}")

# go run forks a server child; killing its parent can leave that child connected
# after the disposable container has been removed. Build first (no DB access),
# then exec the binary so BACKEND_PID is the only writable server process.
(cd "${ROOT}/backend-go" && "${GATE_BASE_ENV[@]}" go build -o "${TMP_ROOT}/granete-server" ./cmd/server) \
  || fail "backend build failed before launch"
(cd "${ROOT}/backend-go" && exec "${GATE_SERVER_ENV[@]}" \
  "${TMP_ROOT}/granete-server" >"${TMP_ROOT}/backend.log" 2>&1) &
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

(cd "${ROOT}/backend-go" && "${GATE_ADMIN_ENV[@]}" go run ./cmd/admin create \
  --email "${ORGANIZATION_GATE_A_OWNER_EMAIL}" --name "Browser Gate A Owner") >/dev/null
(cd "${ROOT}/backend-go" && "${GATE_ADMIN_ENV[@]}" go run ./cmd/admin create \
  --email "${ORGANIZATION_GATE_B_OWNER_EMAIL}" --name "Browser Gate B Owner") >/dev/null
(cd "${ROOT}/backend-go" && "${GATE_ADMIN_ENV[@]}" go run ./cmd/admin create-platform-admin \
  --email "${ORGANIZATION_GATE_A_OWNER_EMAIL}") >/dev/null
(cd "${ROOT}/backend-go" && "${GATE_ADMIN_ENV[@]}" go run ./cmd/admin create-org \
  --name "Browser Gate A" --slug browser-gate-a --type factory \
  --admin-email "${ORGANIZATION_GATE_A_OWNER_EMAIL}" \
  --idempotency-key browser-gate-a-bootstrap --license trial) >/dev/null
(cd "${ROOT}/backend-go" && "${GATE_ADMIN_ENV[@]}" go run ./cmd/admin create-org \
  --name "Browser Gate B" --slug browser-gate-b --type factory \
  --admin-email "${ORGANIZATION_GATE_B_OWNER_EMAIL}" \
  --idempotency-key browser-gate-b-bootstrap --license pro) >/dev/null
SETUP_READBACK="$(docker exec "${CONTAINER}" psql -At -U postgres -d granete_gate \
  -c "SELECT current_database(),
      (SELECT count(*) FROM users WHERE email IN ('browser-gate-a-owner@example.com', 'browser-gate-b-owner@example.com')),
      (SELECT count(*) FROM organizations WHERE slug IN ('browser-gate-a', 'browser-gate-b'))")"
[ "${SETUP_READBACK}" = 'granete_gate|2|2' ] || fail "disposable users and organizations did not match preparation"
printf '[organization-gate] disposable preparation readback: database=granete_gate users=2 organizations=2\n'
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

# #642 legacy recovery: specs may seed PRE-migration row shapes (snapshot-less
# quote revisions) that no API can produce — the modern commands always freeze
# a snapshot. Read-only-from-app perspective: admin DSN for fixture seeding
# only; the verified FLOW always goes through the real API.
# Only these harmless names may appear in uploaded diagnostics. Values never do.
GATE_BROWSER_SAFE_NAMES=(CI GITHUB_ACTIONS RUNNER_OS RUNNER_ARCH
  LANG LC_ALL LC_CTYPE LANGUAGE USER LOGNAME SHELL
  XDG_SESSION_TYPE XDG_CURRENT_DESKTOP)
GATE_BROWSER_AVAILABLE_NAMES=()
GATE_BROWSER_FORWARDED_NAMES=()
for key in "${GATE_BROWSER_SAFE_NAMES[@]}"; do
  if [ "${!key+x}" = x ]; then GATE_BROWSER_AVAILABLE_NAMES+=("${key}"); fi
done
ambient_db_pg_count=0
ambient_credential_count=0
ambient_proxy_count=0
ambient_unclassified_key_count=0
if [ "${PTX_BROWSER_MODE}" = inherited-safe ]; then
  # Experiment 1 comparator only: backend/admin retain GATE_BASE_ENV.
  GATE_BROWSER_PREFIX=(env)
  for key in "${GATE_BROWSER_AVAILABLE_NAMES[@]}"; do
    # The existing inherited-safe scrub removes SESSION-shaped keys, including
    # this harmless XDG name; report what reaches the child, not what existed.
    if [ "${key}" != XDG_SESSION_TYPE ]; then GATE_BROWSER_FORWARDED_NAMES+=("${key}"); fi
  done
else
  GATE_BROWSER_PREFIX=(env -i)
  if [ "${PTX_BROWSER_MODE}" != isolated ]; then
    for key in "${PTX_BROWSER_GROUP_NAMES[@]}"; do
      if [ "${!key+x}" = x ] && [ -n "${!key}" ]; then
        GATE_BROWSER_PREFIX+=("${key}=${!key}")
        GATE_BROWSER_FORWARDED_NAMES+=("${key}")
      fi
    done
  fi
fi
# Count dangerous *classes*, never upload their names or values. Inherited-safe
# removes every matching ambient key before reapplying disposable T2 targets.
while IFS= read -r key; do
  key_upper="$(LC_ALL=C tr '[:lower:]' '[:upper:]' <<< "${key}")"
  case "${key_upper}" in
    PG*|*DATABASE*|DB_*|*DB_URL*|*DB_HOST*|*DB_NAME*|*DB_PORT*|*DB_USER*|*DB_PASS*|*POSTGRES*|*DSN*|*CONNECTION*)
      ambient_db_pg_count=$((ambient_db_pg_count + 1))
      if [ "${PTX_BROWSER_MODE}" = inherited-safe ]; then GATE_BROWSER_PREFIX+=(-u "${key}"); fi ;;
    *SECRET*|*TOKEN*|*PASSWORD*|*PASSWD*|*CREDENTIAL*|*PRIVATE*KEY*|*ACCESS*KEY*|*API*KEY*|*COOKIE*|*SESSION*|*AUTH*)
      ambient_credential_count=$((ambient_credential_count + 1))
      if [ "${PTX_BROWSER_MODE}" = inherited-safe ]; then GATE_BROWSER_PREFIX+=(-u "${key}"); fi ;;
    DOCKER_HOST|DOCKER_CONTEXT|KUBECONFIG|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)
      ambient_proxy_count=$((ambient_proxy_count + 1))
      if [ "${PTX_BROWSER_MODE}" = inherited-safe ]; then GATE_BROWSER_PREFIX+=(-u "${key}"); fi ;;
    CI|GITHUB_ACTIONS|RUNNER_OS|RUNNER_ARCH|LANG|LC_ALL|LC_CTYPE|LANGUAGE|USER|LOGNAME|SHELL|XDG_CURRENT_DESKTOP) ;;
    *) ambient_unclassified_key_count=$((ambient_unclassified_key_count + 1)) ;;
  esac
done < <(compgen -e)
if [ -n "${PTX_DIAGNOSTIC_DIR:-}" ]; then
  mkdir -p "${PTX_DIAGNOSTIC_DIR}"
  join_safe_names() { local IFS=,; printf '%s' "$*"; }
  {
    printf 'variant=%s\n' "${PTX_BROWSER_MODE}"
    printf 'available_safe_names=%s\n' "$(join_safe_names "${GATE_BROWSER_AVAILABLE_NAMES[@]}")"
    printf 'forwarded_safe_names=%s\n' "$(join_safe_names "${GATE_BROWSER_FORWARDED_NAMES[@]}")"
    printf 'ambient_db_pg_count=%s\n' "${ambient_db_pg_count}"
    printf 'ambient_credential_count=%s\n' "${ambient_credential_count}"
    printf 'ambient_proxy_count=%s\n' "${ambient_proxy_count}"
    printf 'ambient_unclassified_key_count=%s\n' "${ambient_unclassified_key_count}"
  } > "${PTX_DIAGNOSTIC_DIR}/browser-env-safe-names.txt"
fi
GATE_BROWSER_ENV=("${GATE_BROWSER_PREFIX[@]}"
  PATH="${PATH}" HOME="${HOME:-/}" TMPDIR="${TMPDIR:-/tmp}"
  ORGANIZATION_TEST_ISOLATED="${ORGANIZATION_TEST_ISOLATED}"
  GRANETE_TEST_DATABASE="${GRANETE_TEST_DATABASE}"
  DATABASE_URL="${DATABASE_URL}"
  MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL}"
  ORGANIZATION_TEST_DATABASE_URL="${ORGANIZATION_TEST_DATABASE_URL}"
  ORGANIZATION_GATE_DB_IDENTITY_SHA256="${GATE_DB_IDENTITY_SHA256}"
  MEDIA_DIR="${MEDIA_DIR}"
  ORGANIZATION_WEB_PORT="${ORGANIZATION_WEB_PORT}"
  ORGANIZATION_GATE_EMAIL="${ORGANIZATION_GATE_EMAIL}"
  ORGANIZATION_GATE_A_OWNER_EMAIL="${ORGANIZATION_GATE_A_OWNER_EMAIL}"
  ORGANIZATION_GATE_B_OWNER_EMAIL="${ORGANIZATION_GATE_B_OWNER_EMAIL}"
  ORGANIZATION_GATE_ORG_A_SLUG=browser-gate-a ORGANIZATION_GATE_ORG_B_SLUG=browser-gate-b
  ORGANIZATION_GATE_ORG_SLUG=browser-gate-a
  ORGANIZATION_GATE_PASSWORD="${ADMIN_PASSWORD}"
  ORGANIZATION_API_BASE="http://127.0.0.1:${BACKEND_PORT}/api"
  VITE_API_BASE="http://127.0.0.1:${BACKEND_PORT}/api"
  VITE_PTX_DIAGNOSTIC=1
  ORGANIZATION_TEST_OUTPUT="${TMP_ROOT}/playwright-output")

cd "${ROOT}"
"${GATE_BROWSER_ENV[@]}" pnpm exec playwright test --config=playwright.organization.config.ts "$@"
printf '[organization-gate] PASS\n'
