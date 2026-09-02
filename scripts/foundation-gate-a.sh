#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/granete-foundation-gate-a.XXXXXX")"

cleanup() {
  rm -rf "${OUTPUT}"
}
trap cleanup EXIT INT TERM

fail() {
  printf '[foundation-gate-a] FAIL: %s\n' "$1" >&2
  exit 1
}

for command in docker go pnpm python3 pg_dump pg_restore; do
  command -v "${command}" >/dev/null 2>&1 || fail "${command} is required; Gate A never skips missing infrastructure"
done
docker info >/dev/null 2>&1 || fail "Docker is not available"

run_no_skip() {
  local name="$1"
  shift
  local log="${OUTPUT}/${name}.log"
  "$@" 2>&1 | tee "${log}"
  if grep -E -- '(^|[[:space:]])(SKIP|skipped)(:|[[:space:]])|--- SKIP:' "${log}" >/dev/null; then
    fail "${name} reported a skipped proof"
  fi
}

cd "${ROOT}"
printf '[foundation-gate-a] generated contract\n'
pnpm openapi:check
printf '[foundation-gate-a] TypeScript contract and behavior\n'
pnpm typecheck
pnpm test
printf '[foundation-gate-a] deployment structure\n'
scripts/smoke-deploy.sh
printf '[foundation-gate-a] PostgreSQL/RLS/API/fresh/upgrade/atomic proofs\n'
run_no_skip postgres env PILOT_GATE_FOUNDATION_A=1 scripts/pilot-gate.sh --fresh-container
printf '[foundation-gate-a] real browser/auth/MFA/tenant proofs\n'
run_no_skip browser scripts/organization-browser-gate.sh
git diff --check
printf '[foundation-gate-a] PASS — 34/34 Foundation scenarios executable; #385 DT-1 may start\n'
