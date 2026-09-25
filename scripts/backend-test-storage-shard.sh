#!/usr/bin/env bash
# Run one isolated internal/storage test shard for #842.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COUNT="${1:?usage: backend-test-storage-shard.sh <count> <one-based-index> [hash|lpt] [timing-log]}"
INDEX="${2:?usage: backend-test-storage-shard.sh <count> <one-based-index> [hash|lpt] [timing-log]}"
STRATEGY="${3:-lpt}"
TIMINGS="${4:-}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/granete-storage-shard.XXXXXX")"
trap 'rm -rf "${TMP_ROOT}"' EXIT INT TERM

SHARD_ARGS=(shard -package ./internal/storage -count "${COUNT}" -index "${INDEX}" -strategy "${STRATEGY}")
if [ -n "${TIMINGS}" ]; then
  SHARD_ARGS+=(-timings "${TIMINGS}")
fi

cd "${ROOT}/backend-go"
go run ./cmd/testshard "${SHARD_ARGS[@]}" -format names >"${TMP_ROOT}/expected-roots"
go run ./cmd/testshard "${SHARD_ARGS[@]}" -format run >"${TMP_ROOT}/run-regex"
RUN_REGEX="$(cat "${TMP_ROOT}/run-regex")"
[ -n "${RUN_REGEX}" ] || { echo "storage shard has an empty run selection" >&2; exit 2; }

# The canonical runner creates a dedicated PostgreSQL cluster and preserves -p 1
# and -parallel 1. JSON is verified afterwards against the AST-selected roots.
"${ROOT}/scripts/backend-test.sh" -json -run "${RUN_REGEX}" ./internal/storage | tee "${TMP_ROOT}/go-test.json"
go run ./cmd/testshard verify -expected "${TMP_ROOT}/expected-roots" -json "${TMP_ROOT}/go-test.json"
