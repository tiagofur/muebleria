#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE=all
if [ "$#" -gt 0 ]; then
  [ "$#" -eq 2 ] && [ "$1" = --stage ] || { echo 'Usage: foundation-gate-a.sh [--stage all|postgres|browser]' >&2; exit 2; }
  STAGE="$2"
fi
case "$STAGE" in all|postgres|browser) ;; *) echo 'Unknown Foundation stage' >&2; exit 2 ;; esac
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/granete-foundation-gate-a.XXXXXX")"
cleanup() { rm -rf "${OUTPUT}"; }
trap cleanup EXIT INT TERM
fail() { printf '[foundation-gate-a] FAIL: %s\n' "$1" >&2; exit 1; }

# Standalone default preserves every original proof. CI partitions these stages
# and requires the independent TS/contract jobs in its final Foundation gate.
COMMANDS=(docker go python3)
if [ "$STAGE" != postgres ]; then COMMANDS+=(pnpm); fi
if [ "$STAGE" != browser ]; then COMMANDS+=(pg_dump pg_restore); fi
for command in "${COMMANDS[@]}"; do
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
if [ "$STAGE" = all ]; then
  printf '[foundation-gate-a] generated contract\n'
  pnpm openapi:check
  printf '[foundation-gate-a] TypeScript contract and behavior\n'
  pnpm typecheck
  pnpm test
fi
if [ "$STAGE" != browser ]; then
  printf '[foundation-gate-a] deployment structure\n'
  scripts/smoke-deploy.sh
  printf '[foundation-gate-a] PostgreSQL/RLS/API/fresh/upgrade/atomic proofs\n'
  run_no_skip postgres env PILOT_GATE_FOUNDATION_A=1 scripts/pilot-gate.sh --fresh-container
fi
if [ "$STAGE" != postgres ]; then
  printf '[foundation-gate-a] real browser/auth/MFA/tenant proofs\n'
  run_no_skip browser scripts/organization-browser-gate.sh
fi
git diff --check
printf '[foundation-gate-a] PASS stage=%s (a partial stage alone is not complete Gate A evidence)\n' "$STAGE"
