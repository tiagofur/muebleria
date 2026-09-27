#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_ROOT="${TMPDIR:-/tmp}/granete-organization-sessions-$(id -u)"
RUN_ID=""
RUN_DIR=""
INTERACTIVE=""
ENVIRONMENT_STATE="STARTING"
AUTOMATED_RESULT="NOT_RUN"
HOST_RESULT="NOT_RUN"
FINAL_STATE="ABORTED"
FAILURE_REASON=""
EXPIRES_AT=""
WEB_PID=""
BROWSER_PID=""
GATE_TEST_PID=""
umask 077

session_state() {
  printf 'run_id=%s\nenvironment_state=%s\nautomated_result=%s\nhost_result=%s\nexpires_at_epoch=%s\napi_url=http://127.0.0.1:%s/api\nweb_url=http://127.0.0.1:%s\ncleanup=%s\nfailure_reason=%s\n' \
    "${RUN_ID}" "${ENVIRONMENT_STATE}" "${AUTOMATED_RESULT}" "${HOST_RESULT}" \
    "${EXPIRES_AT}" "${BACKEND_PORT:-}" "${ORGANIZATION_WEB_PORT:-}" "${CLEANUP_RESULT:-PENDING}" "${FAILURE_REASON}" \
    >"${RUN_DIR}/state.next"
  mv "${RUN_DIR}/state.next" "${RUN_DIR}/state"
}

session_id_valid() { [[ "${1:-}" =~ ^[a-f0-9]{24}$ ]]; }
session_field() { sed -n "s/^${2}=//p" "${1}/state" 2>/dev/null | head -1 || true; }

remember_process() {
  [ -n "${INTERACTIVE}" ] || return 0
  local pid="$1" kind="$2" start
  start="$(ps -p "${pid}" -o lstart= 2>/dev/null | xargs)"
  printf '%s\n%s\n' "${pid}" "${start}" >"${RUN_DIR}/${kind}.owner"
}

owned_process() {
  local kind="$1" pid start current command
  [ -f "${RUN_DIR}/${kind}.owner" ] || return 1
  pid="$(sed -n '1p' "${RUN_DIR}/${kind}.owner")"
  start="$(sed -n '2p' "${RUN_DIR}/${kind}.owner")"
  [[ "${pid}" =~ ^[0-9]+$ ]] && [ -n "${start}" ] || return 1
  current="$(ps -p "${pid}" -o lstart= 2>/dev/null | xargs)"
  [ "${current}" = "${start}" ] || return 1
  command="$(ps -p "${pid}" -o command= 2>/dev/null)"
  case "${kind}" in
    backend) [[ "${command}" == *"$(cat "${RUN_DIR}/tmp-root")/granete-server"* ]] ;;
    web) [[ "${command}" == *vite/bin/vite.js* && "${command}" == *"--port $(cat "${RUN_DIR}/web-port")"* ]] ;;
    browser) [[ "${command}" == *organization-interactive-browser.mjs* && "${command}" == *"${RUN_ID}"* ]] ;;
    *) return 1 ;;
  esac
}

recover_orphan() {
  local kind pid result=COMPLETE container tmp_root remaining
  AUTOMATED_RESULT="$(session_field "${RUN_DIR}" automated_result)"
  HOST_RESULT="$(session_field "${RUN_DIR}" host_result)"
  EXPIRES_AT="$(session_field "${RUN_DIR}" expires_at_epoch)"
  FAILURE_REASON=owner_exited_without_cleanup
  for kind in browser web backend; do
    if owned_process "${kind}"; then
      pid="$(sed -n '1p' "${RUN_DIR}/${kind}.owner")"
      kill -TERM "${pid}" 2>/dev/null || true
      for _ in $(seq 1 10); do
        owned_process "${kind}" || break
        sleep 1
      done
      owned_process "${kind}" && result=INCOMPLETE
    fi
  done
  container="$(cat "${RUN_DIR}/container" 2>/dev/null || true)"
  if [[ "${container}" =~ ^granete-org-gate-[0-9]+-[a-f0-9]{8}$ ]]; then
    docker rm -f "${container}" >/dev/null 2>&1 || true
    if remaining="$(docker ps -aq --filter "name=^/${container}$" 2>/dev/null)"; then
      [ -z "${remaining}" ] || result=INCOMPLETE
    else
      result=INCOMPLETE
    fi
  else
    result=INCOMPLETE
  fi
  tmp_root="$(cat "${RUN_DIR}/tmp-root" 2>/dev/null || true)"
  if [[ "${tmp_root}" == "${TMPDIR:-/tmp}"/granete-organization-gate.* ]]; then
    rm -rf -- "${tmp_root}"
    [ ! -e "${tmp_root}" ] || result=INCOMPLETE
  else
    result=INCOMPLETE
  fi
  CLEANUP_RESULT="${result}"
  ENVIRONMENT_STATE=INCOMPLETE
  FINAL_STATE=INCOMPLETE
  session_state
  [ "${result}" = COMPLETE ]
}

case "${1:-}" in
  prepare)
    shift
    [ "$#" -gt 0 ] || { echo '[organization-gate] a test spec is required' >&2; exit 2; }
    if [ -n "${ORGANIZATION_GATE_MAX_AGE_SECONDS:-}" ]; then
      [[ "${ORGANIZATION_GATE_MAX_AGE_SECONDS}" =~ ^[0-9]+$ ]] &&
        [ "${ORGANIZATION_GATE_MAX_AGE_SECONDS}" -ge 1 ] &&
        [ "${ORGANIZATION_GATE_MAX_AGE_SECONDS}" -le 3600 ] || {
          echo '[organization-gate] max age must be between 1 and 3600 seconds' >&2; exit 2;
        }
    fi
    mkdir -p "${SESSION_ROOT}"
    chmod 700 "${SESSION_ROOT}"
    RUN_ID="$(openssl rand -hex 12)"
    RUN_DIR="${SESSION_ROOT}/${RUN_ID}"
    mkdir -m 700 "${RUN_DIR}"
    launch_env=(env -i PATH="${PATH}" HOME="${HOME:-/}" TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-}")
    for asset in PHASE1_BLANCO_FROSTY_FILE PHASE1_MOSCATO_FILE; do
      if [ -n "${!asset:-}" ]; then launch_env+=("${asset}=${!asset}"); fi
    done
    if [ -n "${ORGANIZATION_GATE_MAX_AGE_SECONDS:-}" ]; then
      launch_env+=("ORGANIZATION_GATE_MAX_AGE_SECONDS=${ORGANIZATION_GATE_MAX_AGE_SECONDS}")
    fi
    nohup "${launch_env[@]}" bash "${ROOT}/scripts/organization-browser-gate.sh" __serve "${RUN_ID}" "$@" \
      </dev/null >/dev/null 2>&1 &
    owner_pid=$!
    printf '%s\n' "${owner_pid}" >"${RUN_DIR}/owner.pid"
    trap 'kill -TERM "${owner_pid}" 2>/dev/null || true; wait "${owner_pid}" 2>/dev/null || true' INT TERM EXIT
    for _ in $(seq 1 300); do
      state="$(session_field "${RUN_DIR}" environment_state)"
      if [ "${state}" = WAITING_FOR_HUMAN ]; then
        printf 'run-id=%s\n' "${RUN_ID}"
        cat "${RUN_DIR}/state"
        # Keep this terminal attached. Some launchers reap detached descendants
        # as soon as their command exits, despite nohup.
        wait "${owner_pid}" || true
        exit 0
      fi
      if [ "${state}" = ABORTED ] || [ "${state}" = INCOMPLETE ]; then
        cat "${RUN_DIR}/state" >&2
        exit 1
      fi
      kill -0 "$(cat "${RUN_DIR}/owner.pid")" 2>/dev/null || {
        echo "[organization-gate] preparation owner exited; run-id=${RUN_ID}" >&2
        exit 1
      }
      sleep 1
    done
    printf '[organization-gate] preparation is still running; run-id=%s\n' "${RUN_ID}" >&2
    exit 1
    ;;
  status|continue|stop)
    action="$1"; run_id="${2:-}"
    session_id_valid "${run_id}" || { echo '[organization-gate] invalid run ID' >&2; exit 2; }
    run_dir="${SESSION_ROOT}/${run_id}"
    [ -f "${run_dir}/state" ] || { echo '[organization-gate] run not found' >&2; exit 1; }
    state="$(session_field "${run_dir}" environment_state)"
    if [ "${action}" = status ]; then
      owner="$(cat "${run_dir}/owner.pid" 2>/dev/null || true)"
      if [[ "${state}" != FINISHED && "${state}" != ABORTED && "${state}" != INCOMPLETE ]] &&
        ! ps -p "${owner}" -o command= 2>/dev/null | grep -Fq "__serve ${run_id}"; then
        sed -e 's/^environment_state=.*/environment_state=ORPHANED/' \
          -e 's/^cleanup=.*/cleanup=UNKNOWN/' "${run_dir}/state"
      else
        cat "${run_dir}/state"
      fi
      exit 0
    fi
    if [ "${action}" = stop ] && [[ "${state}" = FINISHED || "${state}" = ABORTED || "${state}" = INCOMPLETE ]]; then
      cat "${run_dir}/state"; exit 0
    fi
    owner="$(cat "${run_dir}/owner.pid" 2>/dev/null || true)"
    [[ "${owner}" =~ ^[0-9]+$ ]] || { echo '[organization-gate] owner unavailable; inspect run resources' >&2; exit 1; }
    if ! ps -p "${owner}" -o command= 2>/dev/null | grep -Fq "__serve ${run_id}"; then
      if [ "${action}" = stop ]; then
        RUN_ID="${run_id}"; RUN_DIR="${run_dir}"
        BACKEND_PORT="$(session_field "${run_dir}" api_url | sed -n 's@.*127.0.0.1:\([0-9]*\)/api@\1@p')"
        ORGANIZATION_WEB_PORT="$(cat "${run_dir}/web-port" 2>/dev/null || true)"
        recover_orphan
        cat "${run_dir}/state"
        exit 0
      fi
      echo '[organization-gate] owner unavailable; run may need stop recovery' >&2; exit 1
    fi
    if [ "${action}" = continue ]; then
      [ "${state}" = WAITING_FOR_HUMAN ] || { echo '[organization-gate] run is not waiting for a human' >&2; exit 1; }
      : >"${run_dir}/continue"
    else
      : >"${run_dir}/stop"
      kill -TERM "${owner}"
    fi
    for _ in $(seq 1 30); do
      state="$(session_field "${run_dir}" environment_state)"
      if [ "${action}" = continue ] && [ "${state}" = HOST_CHECK_IN_PROGRESS ]; then break; fi
      if [ "${action}" = stop ] && [[ "${state}" = FINISHED || "${state}" = ABORTED || "${state}" = INCOMPLETE ]]; then break; fi
      sleep 1
    done
    if [ "${action}" = stop ] && [[ "${state}" != FINISHED && "${state}" != ABORTED && "${state}" != INCOMPLETE ]]; then
      echo '[organization-gate] cleanup not confirmed; inspect run resources' >&2
      exit 1
    fi
    cat "${run_dir}/state"
    exit 0
    ;;
  __serve)
    RUN_ID="${2:-}"
    session_id_valid "${RUN_ID}" || exit 2
    RUN_DIR="${SESSION_ROOT}/${RUN_ID}"
    [ -d "${RUN_DIR}" ] || exit 2
    INTERACTIVE=1
    max_age="${ORGANIZATION_GATE_MAX_AGE_SECONDS:-3600}"
    [[ "${max_age}" =~ ^[0-9]+$ ]] && [ "${max_age}" -ge 1 ] && [ "${max_age}" -le 3600 ] || {
      echo '[organization-gate] max age must be between 1 and 3600 seconds' >&2; exit 2;
    }
    EXPIRES_AT="$(($(date +%s) + max_age))"
    shift 2
    session_state
    ;;
esac

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/granete-organization-gate.XXXXXX")"
if [ -n "${INTERACTIVE}" ]; then printf '%s\n' "${TMP_ROOT}" >"${RUN_DIR}/tmp-root"; fi
CONTAINER=""
BACKEND_PID=""

cleanup() {
  local previous_status=$? cleanup_result=COMPLETE remaining
  if [ -n "${GATE_TEST_PID}" ]; then
    kill "${GATE_TEST_PID}" >/dev/null 2>&1 || true
    wait "${GATE_TEST_PID}" >/dev/null 2>&1 || true
  fi
  if [ -n "${BROWSER_PID}" ]; then
    kill "${BROWSER_PID}" >/dev/null 2>&1 || true
    wait "${BROWSER_PID}" >/dev/null 2>&1 || true
    kill -0 "${BROWSER_PID}" >/dev/null 2>&1 && cleanup_result=INCOMPLETE
  fi
  if [ -n "${WEB_PID}" ]; then
    kill "${WEB_PID}" >/dev/null 2>&1 || true
    wait "${WEB_PID}" >/dev/null 2>&1 || true
    kill -0 "${WEB_PID}" >/dev/null 2>&1 && cleanup_result=INCOMPLETE
  fi
  if [ -n "${BACKEND_PID}" ]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
    wait "${BACKEND_PID}" >/dev/null 2>&1 || true
    kill -0 "${BACKEND_PID}" >/dev/null 2>&1 && cleanup_result=INCOMPLETE
  fi
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  if [ -n "${CONTAINER}" ]; then
    if remaining="$(docker ps -aq --filter "name=^/${CONTAINER}$" 2>/dev/null)"; then
      [ -z "${remaining}" ] || cleanup_result=INCOMPLETE
    else
      cleanup_result=INCOMPLETE
    fi
  fi
  rm -rf "${TMP_ROOT}"
  [ ! -e "${TMP_ROOT}" ] || cleanup_result=INCOMPLETE
  unset POSTGRES_PASSWORD APP_DATABASE_PASSWORD JWT_SECRET REFRESH_TOKEN_PEPPER MEDIA_SIGNING_KEY MFA_ENCRYPTION_KEY ADMIN_PASSWORD ORGANIZATION_TEST_DATABASE_URL
  if [ -n "${INTERACTIVE}" ]; then
    if [ -f "${RUN_DIR}/stop" ]; then FINAL_STATE=FINISHED; fi
    if [ "${previous_status}" -ne 0 ] && [ -z "${FAILURE_REASON}" ] && [ "${FINAL_STATE}" != FINISHED ]; then
      FAILURE_REASON=unexpected_exit
    fi
    ENVIRONMENT_STATE="${FINAL_STATE}"
    CLEANUP_RESULT="${cleanup_result}"
    session_state
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fail() {
  FAILURE_REASON="$1"
  printf '[organization-gate] FAIL: %s\n' "$1" >&2
  exit 1
}

# Chromium needs a UTF-8 process locale to preserve Unicode download names.
# Validate before starting Docker or any writable child; never inherit other
# ambient locale, database, or credential settings into the scoped children.
BROWSER_LANG="${LANG:-}"
if [[ ! "${BROWSER_LANG}" =~ ^[A-Za-z][A-Za-z0-9_-]*\.[Uu][Tt][Ff]-?8(@[A-Za-z0-9_-]+)?$ ]]; then
  fail "LANG must name a UTF-8 locale for the browser gate"
fi

for command in docker go pnpm curl openssl python3; do
  command -v "${command}" >/dev/null 2>&1 || fail "${command} is required"
done
docker info >/dev/null 2>&1 || fail "Docker is not available"
CONTAINER="granete-org-gate-$$-$(openssl rand -hex 4)"
if [ -n "${INTERACTIVE}" ]; then printf '%s\n' "${CONTAINER}" >"${RUN_DIR}/container"; fi

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
if [ -n "${INTERACTIVE}" ]; then printf '%s\n' "${ORGANIZATION_WEB_PORT}" >"${RUN_DIR}/web-port"; fi
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
  MEDIA_DIR="${MEDIA_DIR}" PORT="${BACKEND_PORT}" ORGANIZATION_GATE_BIND_HOST=127.0.0.1
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
remember_process "${BACKEND_PID}" backend
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
GATE_BROWSER_ENV=("${GATE_BASE_ENV[@]}"
  LANG="${BROWSER_LANG}"
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
  ORGANIZATION_TEST_OUTPUT="${TMP_ROOT}/playwright-output")

run_prepared_automatic_gate() {
  cd "${ROOT}"
  "${GATE_BROWSER_ENV[@]}" pnpm exec playwright test --config=playwright.organization.config.ts "$@"
  printf '[organization-gate] PASS\n'
}

run_prepared_interactive_gate() {
  ENVIRONMENT_STATE=PREPARATION_RUNNING
  AUTOMATED_RESULT=FAIL
  session_state

  # Playwright must reuse this exact Vite process; its normal webServer entry
  # would otherwise close the human-facing site when the test finishes.
  (cd "${ROOT}/apps/web" && exec env -i PATH="${PATH}" HOME="${HOME:-/}" \
    TMPDIR="${TMPDIR:-/tmp}" VITE_API_BASE="http://127.0.0.1:${BACKEND_PORT}/api" \
    node node_modules/vite/bin/vite.js --host 127.0.0.1 \
      --port "${ORGANIZATION_WEB_PORT}" --strictPort >"${TMP_ROOT}/web.log" 2>&1) &
  WEB_PID=$!
  remember_process "${WEB_PID}" web
  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:${ORGANIZATION_WEB_PORT}" >/dev/null 2>&1; then break; fi
    kill -0 "${WEB_PID}" >/dev/null 2>&1 || fail "interactive web server exited"
    sleep 1
  done
  curl -fsS "http://127.0.0.1:${ORGANIZATION_WEB_PORT}" >/dev/null \
    || fail "interactive web server did not become ready"

  (cd "${ROOT}" && exec "${GATE_BROWSER_ENV[@]}" ORGANIZATION_GATE_EXTERNAL_WEB=1 \
    pnpm exec playwright test --config=playwright.organization.config.ts "$@" \
    >"${TMP_ROOT}/automated.log" 2>&1) &
  GATE_TEST_PID=$!
  wait "${GATE_TEST_PID}" || fail "interactive automated segment failed"
  GATE_TEST_PID=""
  AUTOMATED_RESULT=PASS

  profile="${TMP_ROOT}/browser-profile"
  mkdir -m 700 "${profile}"
  ready="${TMP_ROOT}/browser.ready"
  (cd "${ROOT}" && exec env -i PATH="${PATH}" HOME="${HOME:-/}" \
    TMPDIR="${TMPDIR:-/tmp}" LANG="${BROWSER_LANG}" \
    ORGANIZATION_GATE_EMAIL="${ORGANIZATION_GATE_EMAIL}" \
    ORGANIZATION_GATE_PASSWORD="${ADMIN_PASSWORD}" \
    ORGANIZATION_GATE_ORG_NAME='Browser Gate A' \
    ORGANIZATION_WEB_URL="http://127.0.0.1:${ORGANIZATION_WEB_PORT}" \
    ORGANIZATION_BROWSER_PROFILE="${profile}" ORGANIZATION_BROWSER_READY="${ready}" \
    node scripts/organization-interactive-browser.mjs "${RUN_ID}" \
    >"${TMP_ROOT}/browser.log" 2>&1) &
  BROWSER_PID=$!
  remember_process "${BROWSER_PID}" browser
  for _ in $(seq 1 120); do
    [ -f "${ready}" ] && break
    kill -0 "${BROWSER_PID}" >/dev/null 2>&1 || fail "interactive browser exited before readiness"
    sleep 1
  done
  [ -f "${ready}" ] || fail "interactive browser did not become ready"
  ENVIRONMENT_STATE=WAITING_FOR_HUMAN
  session_state
  while [ "$(date +%s)" -lt "${EXPIRES_AT}" ]; do
    if [ -f "${RUN_DIR}/stop" ]; then FINAL_STATE=FINISHED; break; fi
    if [ -f "${RUN_DIR}/continue" ] && [ "${ENVIRONMENT_STATE}" = WAITING_FOR_HUMAN ]; then
      rm -f "${RUN_DIR}/continue"
      ENVIRONMENT_STATE=HOST_CHECK_IN_PROGRESS
      session_state
    fi
    if ! kill -0 "${BACKEND_PID}" "${WEB_PID}" "${BROWSER_PID}" >/dev/null 2>&1; then
      FINAL_STATE=INCOMPLETE
      break
    fi
    sleep 1
  done
  [ "${FINAL_STATE}" = ABORTED ] && FINAL_STATE=INCOMPLETE
}

# Both modes share the complete preparation above. Only the explicit internal
# supervisor entry keeps the disposable resources after Playwright completes.
if [ -n "${INTERACTIVE}" ]; then
  run_prepared_interactive_gate "$@"
else
  run_prepared_automatic_gate "$@"
fi
