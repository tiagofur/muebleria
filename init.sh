#!/usr/bin/env bash
# init.sh — Verificación e inicialización del entorno
#
# Lo ejecuta el agente al COMENZAR una sesión y antes de declarar cualquier
# tarea como `done`. Si falla, la sesión no debe avanzar.
#
# Modos:
#   bootstrap — monorepo TS aún no scaffolded; solo valida el harness.
#   full      — monorepo existe; valida harness + instala deps + corre tests.
#
# Salida: [OK] / [WARN] / [FAIL] por sección. Exit code 0 solo si todo verde.

set -u
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
  "docs/prd.md"
  "docs/architecture.md"
  "docs/conventions.md"
  "docs/verification.md"
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

if ! command -v node >/dev/null 2>&1; then
  warn "node no está instalado — necesario para el monorepo TS"
  warn "Instalar: https://nodejs.org (LTS >= 20)"
  # No falla en bootstrap; el monorepo puede no existir aún
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
  warn "pnpm no está instalado — necesario para el monorepo"
  warn "Instalar: npm install -g pnpm  o  corepack enable"
else
  ok "pnpm $(pnpm --version)"
fi

# ── 4. Monorepo TS (solo si existe) ─────────────────────────────────────────
echo ""
echo "── 4. Monorepo TypeScript ──────────────────────────────"

if [ ! -f "package.json" ]; then
  warn "package.json no encontrado — modo bootstrap (monorepo aún no scaffolded)"
  info "La primera feature pendiente en feature_list.json es el scaffold."
  info "Cuando exista package.json, este paso instalará deps y correrá tests."
else
  ok "package.json existe"

  if command -v pnpm >/dev/null 2>&1; then
    info "Instalando dependencias..."
    if pnpm install --frozen-lockfile 2>/dev/null || pnpm install; then
      ok "pnpm install completado"
    else
      fail "pnpm install falló"
      EXIT_CODE=1
    fi

    info "Ejecutando tests..."
    if pnpm test 2>&1; then
      ok "Todos los tests pasan"
    else
      fail "Hay tests rotos"
      EXIT_CODE=1
    fi
  else
    warn "pnpm no disponible — saltando install y tests"
  fi
fi

# ── 5. Resumen ───────────────────────────────────────────────────────────────
echo ""
echo "── 5. Resumen ──────────────────────────────────────────"

if [ $EXIT_CODE -eq 0 ]; then
  ok "Entorno listo. Puedes empezar a trabajar."
  echo ""
  info "Próximos pasos:"
  info "  1. Lee AGENTS.md para orientarte."
  info "  2. Abre feature_list.json y toma la siguiente tarea pending."
  info "  3. Documenta en progress/current.md antes de tocar código."
else
  fail "Entorno NO está listo. Resuelve los errores antes de avanzar."
fi

exit $EXIT_CODE
