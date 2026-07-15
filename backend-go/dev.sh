#!/usr/bin/env bash
#
# dev.sh — arranca el backend Go en local usando las variables de .env.local.
#
# Uso:
#   ./dev.sh                 # arranca el servidor (go run ./cmd/server)
#   ./dev.sh admin reset-password --email admin@mitaller.com
#   ./dev.sh build            # solo compila, no arranca
#
# Carga ../.env.local (raíz del repo). Si no existe, usa defaults de desarrollo
# pero NO arranca sin JWT_SECRET — el server falla cerrado por diseño.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "⚠ No se encontró $ENV_FILE" >&2
  echo "  Copia .env.example -> .env.local y completa JWT_SECRET:" >&2
  echo "    cp .env.example .env.local" >&2
  echo "    # edita .env.local: JWT_SECRET=\$(openssl rand -base64 48)" >&2
  exit 1
fi

# Exportar todas las vars de .env.local al entorno (set -a / set +a).
# Solo KEY=VALUE; se ignoran líneas vacías y comentarios (#).
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

cd "$SCRIPT_DIR"

SUBCMD="${1:-serve}"
case "$SUBCMD" in
  serve)
    echo "▶ Arrancando backend Go con .env.local (PORT=${PORT:-8080})..."
    exec go run ./cmd/server
    ;;
  build)
    echo "▶ Compilando backend Go..."
    go build -o /tmp/muebles-server ./cmd/server
    echo "✓ Binario en /tmp/muebles-server"
    ;;
  admin)
    shift
    echo "▶ cmd/admin $*"
    exec go run ./cmd/admin "$@"
    ;;
  test)
    shift
    echo "▶ go test $*"
    exec go test "$@" ./...
    ;;
  *)
    echo "Uso: $0 {serve|build|admin|test}" >&2
    exit 2
    ;;
esac
