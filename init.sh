#!/usr/bin/env bash
# init.sh — Verificación e inicialización del entorno
#
# Lo ejecuta el agente al COMENZAR una sesión y antes de declarar cualquier
# tarea como `done`. Si falla, la sesión no debe avanzar.
#
# Modos:
#   bootstrap — monorepo TS aún no scaffolded; solo valida el harness.
#   full      — monorepo existe; valida harness + instala deps + tests (TS, Go y SketchUp Ruby).
#
# Salida: [OK] / [WARN] / [FAIL] por sección. Exit code 0 solo si todo verde.

set -u
export PATH="$PWD/node_modules/.bin:$PATH"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { printf "${GREEN}[OK]${NC}    %s\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${NC}  %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC}  %s\n" "$1"; }
info() { printf "${BLUE}[INFO]${NC}  %s\n" "$1"; }

EXIT_CODE=0

# ── 1. Harness base ──────────────────────────────────────────────────────────
echo "── 1. Verificando harness ──────────────────────────────"

HARNESS_FILES=(
  "AGENTS.md"
  "feature_list.json"
  "progress/current.md"
  "docs/prd-v2.md"
  "docs/architecture.md"
  "docs/conventions.md"
  "docs/verification.md"
  "docs/operational-core-v1.md"
  "CHECKPOINTS.md"
  ".agents/skills/leader/SKILL.md"
  ".agents/skills/implementer/SKILL.md"
  ".agents/skills/reviewer/SKILL.md"
)

for f in "${HARNESS_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    fail "Falta archivo base: $f"
    EXIT_CODE=1
  else
    ok "Existe $f"
  fi
done

# ── 2. Validar feature_list.json ─────────────────────────────────────────────
echo ""
echo "── 2. Validando feature_list.json ──────────────────────"

python3 - <<'PY'
import json, sys
try:
    data = json.load(open("feature_list.json"))
    valid = {"pending", "in_progress", "done", "blocked"}
    in_progress = [f for f in data["features"] if f["status"] == "in_progress"]
    if len(in_progress) > 1:
        print(f"[FAIL]  Hay {len(in_progress)} features en in_progress (máximo 1)")
        sys.exit(1)
    for f in data["features"]:
        if f["status"] not in valid:
            print(f"[FAIL]  Estado inválido en feature {f['id']}: {f['status']}")
            sys.exit(1)
    print(f"[OK]    feature_list.json válido ({len(data['features'])} features, "
          f"{len(in_progress)} en progreso)")
except Exception as e:
    print(f"[FAIL]  feature_list.json inválido: {e}")
    sys.exit(1)
PY

if [ $? -ne 0 ]; then EXIT_CODE=1; fi

# ── 3. Entorno Node / pnpm ───────────────────────────────────────────────────
echo ""
echo "── 3. Verificando entorno Node.js / pnpm ───────────────"

HAS_PACKAGE_JSON=false
if [ -f "package.json" ]; then
  HAS_PACKAGE_JSON=true
fi

if ! command -v node >/dev/null 2>&1; then
  if [ "$HAS_PACKAGE_JSON" = true ]; then
    fail "node no está instalado — obligatorio para el monorepo TS (LTS >= 20)"
    EXIT_CODE=1
  else
    warn "node no está instalado (modo bootstrap)"
  fi
else
  NODE_VER=$(node --version)
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -lt 20 ]; then
    fail "Se requiere Node.js >= 20 (actual: $NODE_VER)"
    EXIT_CODE=1
  else
    ok "node $NODE_VER"
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if [ "$HAS_PACKAGE_JSON" = true ]; then
    fail "pnpm no está instalado — obligatorio para el monorepo (instalar: corepack enable o npm i -g pnpm)"
    EXIT_CODE=1
  else
    warn "pnpm no está instalado (modo bootstrap)"
  fi
else
  ok "pnpm $(pnpm --version)"
fi

# ── 4. Monorepo TS (solo si existe) ─────────────────────────────────────────
echo ""
echo "── 4. Monorepo TypeScript ──────────────────────────────"

if [ "$HAS_PACKAGE_JSON" = false ]; then
  warn "package.json no encontrado — modo bootstrap (monorepo aún no scaffolded)"
else
  ok "package.json existe"

  if command -v pnpm >/dev/null 2>&1; then
    info "Instalando dependencias..."
    if pnpm install --prefer-offline 2>&1; then
      ok "pnpm install completado"
    else
      fail "pnpm install falló"
      EXIT_CODE=1
    fi

    info "Verificando tipos (typecheck)..."
    if pnpm typecheck 2>&1; then
      ok "pnpm typecheck completado sin errores"
    else
      fail "Hay errores de tipado (pnpm typecheck falló)"
      EXIT_CODE=1
    fi

    info "Ejecutando tests TS..."
    if pnpm test 2>&1; then
      ok "Todos los tests de TypeScript pasan"
    else
      fail "Hay tests de TypeScript rotos"
      EXIT_CODE=1
    fi
  fi
fi

# ── 5. Backend Go (si existe) ───────────────────────────────────────────────
echo ""
echo "── 5. Backend Go ───────────────────────────────────────"

if [ -f "backend-go/go.mod" ]; then
  if ! command -v go >/dev/null 2>&1; then
    fail "go no está instalado — requerido para backend-go"
    EXIT_CODE=1
  else
    ok "go $(go version | awk '{print $3}')"
    info "Ejecutando tests Go..."
    if (cd backend-go && go test ./... 2>&1); then
      ok "Todos los tests de Go pasan"
    else
      fail "Hay tests de Go rotos"
      EXIT_CODE=1
    fi
  fi
else
  info "backend-go/go.mod no existe — omitiendo backend Go"
fi

# ── 6. Extensión SketchUp Ruby (si existe) ──────────────────────────────────
echo ""
echo "── 6. Extensión SketchUp Ruby ──────────────────────────"

SKETCHUP_EXTENSION_DIR="apps/sketchup-extension"
if [ -f "$SKETCHUP_EXTENSION_DIR/Gemfile" ]; then
  if [ -x "/opt/homebrew/opt/ruby@3.2/bin/ruby" ]; then
    export PATH="/opt/homebrew/opt/ruby@3.2/bin:/opt/homebrew/lib/ruby/gems/3.2.0/bin:$PATH"
  fi

  RUBY_READY=false
  BUNDLER_READY=false
  REQUIRED_RUBY=$(tr -d '[:space:]' < "$SKETCHUP_EXTENSION_DIR/.ruby-version")
  REQUIRED_BUNDLER=$(awk '/^BUNDLED WITH$/{getline; gsub(/[[:space:]]/, ""); print}' \
    "$SKETCHUP_EXTENSION_DIR/Gemfile.lock")

  if ! command -v ruby >/dev/null 2>&1; then
    fail "ruby no está instalado — requerido para la extensión SketchUp"
    EXIT_CODE=1
  else
    RUBY_VER=$(ruby -e 'print RUBY_VERSION')
    if [ "$RUBY_VER" != "$REQUIRED_RUBY" ]; then
      fail "La extensión requiere Ruby $REQUIRED_RUBY (actual: $RUBY_VER)"
      EXIT_CODE=1
    else
      ok "ruby $RUBY_VER para la extensión SketchUp"
      RUBY_READY=true
    fi
  fi

  if [ "$RUBY_READY" = true ]; then
    if ! command -v bundle >/dev/null 2>&1; then
      fail "bundle no está instalado — se requiere Bundler $REQUIRED_BUNDLER"
      EXIT_CODE=1
    else
      BUNDLER_VER=$(bundle --version | awk '{print $NF}')
      if [ "$BUNDLER_VER" != "$REQUIRED_BUNDLER" ]; then
        fail "La extensión requiere Bundler $REQUIRED_BUNDLER (actual: $BUNDLER_VER)"
        EXIT_CODE=1
      else
        ok "bundler $BUNDLER_VER"
        BUNDLER_READY=true
      fi
    fi
  fi

  if [ "$BUNDLER_READY" = true ]; then
    info "Verificando dependencias Ruby..."
    if (cd "$SKETCHUP_EXTENSION_DIR" && bundle check 2>&1); then
      ok "Dependencias Ruby disponibles"
    elif (cd "$SKETCHUP_EXTENSION_DIR" && bundle install 2>&1); then
      ok "bundle install completado"
    else
      fail "bundle install falló para la extensión SketchUp"
      EXIT_CODE=1
    fi

    info "Ejecutando gate Ruby/RBZ..."
    if (cd "$SKETCHUP_EXTENSION_DIR" && bundle exec rake verify 2>&1); then
      ok "Gate Ruby/RBZ de SketchUp pasó"
    else
      fail "Gate Ruby/RBZ de SketchUp falló"
      EXIT_CODE=1
    fi
  fi
else
  info "$SKETCHUP_EXTENSION_DIR/Gemfile no existe — omitiendo extensión SketchUp"
fi

# ── 7. Resumen ───────────────────────────────────────────────────────────────
echo ""
echo "── 7. Resumen ──────────────────────────────────────────"

if [ $EXIT_CODE -eq 0 ]; then
  ok "Entorno listo. Todas las verificaciones pasaron exitosamente."
  echo ""
  info "Próximos pasos:"
  info "  1. Lee AGENTS.md para orientarte."
  info "  2. Identifica la feature activa en progress/current.md."
  info "  3. Respeta las fuentes canónicas y documenta antes de cerrar."
else
  fail "Entorno NO está listo. Resuelve los errores antes de avanzar."
fi

exit $EXIT_CODE
