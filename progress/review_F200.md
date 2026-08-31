# Review — feature F200 (#442)

**Veredicto (round 2, head d112b71e):** APPROVED

Rama `feat/442-go-bom-base-parity` (PR #508). Round 1 sobre a6d458c1 devolvió
CHANGES_REQUESTED (ver historial al final); el fix d112b71e cierra el
bloqueante y las alineaciones menores pedidas. Verificado sobre el head nuevo:
working tree clean, rama pushed (nada sin push), diff incremental
`a6d458c1..d112b71e` sin trabajo ajeno (9 archivos, todos de F200).

## Checkpoints (round 2)

- C1: [x] Harness completo; cobertura del gate validada con suites locales +
  CI del PR #508 en d112b71e: 6/6 pass (Go Backend Tests, TypeScript, Ruby ×3,
  Feature List).
- C2: [x] 0 features `in_progress`; F200 `done` con tests que pasan;
  `progress/current.md` limpio.
- C3: [x] Boundaries intactos: engine Go puro/tenant-agnostic (el fix no
  introdujo org/session en el dominio); naming espejo; comentarios sólo el
  por qué (paridad truthiness TS, muro length 0, coherencia visual).
- C4: [x] `pnpm --filter @granete/domain test` 97 files / 1237 tests;
  `pnpm typecheck` exit 0; storage con Postgres real; contract 15/15 en ambos
  motores; layout goldens verdes tras el filtrado visual (41 PASS engine+api).
- C5: [x] `progress/history.md` ahora tiene la entrada de la sesión F200
  (honesta: registra el CHANGES_REQUESTED del round 1 y su corrección).
  Sin untracked sospechosos; ledger refleja `done`.

## Resolución del CHANGES_REQUESTED (round 1 → round 2)

1. **Filtrado ZOCLO de agregados (bloqueante) — RESUELTO.**
   `resolve.go` `expandComposedModulePartsWithDims` ahora filtra
   `filterInstancesForBaseMode(agr.Components, catalog, baseMode)` en agregados
   de estructura (`st-agr-`) y de módulo (`mod-agr-`) — espejo de
   `bom.ts:694-699`. `layout.go` `expandLayoutAgregado` recibió `baseMode` y
   filtra por unidad (la vía visual no puede mostrar una pieza que la
   cotización excluye). Goldens de layout re-verdes.
2. **Contract extendido — VERIFICADO.** 15 escenarios; nuevos
   `agregado-zoclo-filtered-in-legs` (anti-phantom vía agregado con override
   ítem legs) y `agregado-zoclo-owns-plinth` (skip-if-present: el zócalo del
   agregado suprime ZOCLO-AUTO). Runner Go mapea agregados reales al dominio y
   exige ≥15 escenarios. Verificación anti-trampa: los 13 escenarios
   originales y todo el catálogo previo están **intactos** (comparación
   semántica old vs new); sólo se añadieron 2 escenarios, `m-bajo-agr`,
   `agr-zoclo` y `comp-zoclo-fixed`. La geometría fija del componente del
   agregado está documentada en `designBomPrice.json` (divergencia TS/Go
   preexistente de fórmulas en sub-espacios de agregados, fuera del scope
   #442) — decisión correcta: el contract congela la semántica de
   filtrado/skip sin congelar la zona divergente.
3. **Alineaciones menores — RESUELTAS.** Guard PATAS ahora espeja truthiness
   TS (string no-vacío sin trim; test propio cubre el caso `" "`); muro con
   `lengthMm` 0 pisa los lados y sólo el muro ausente es no-acotado (espejo de
   `wall?.lengthMm ?? Infinity`; test propio).
4. **C5 — RESUELTO.** Entrada de F200 en `progress/history.md`.

Ambos tests gemelos pasan 15/15 sobre el MISMO
`contracts/plinthBaseParity.contract.json`.

## Observaciones restantes (no bloqueantes, follow-up)

- Divergencia TS/Go preexistente de resolución de fórmulas en sub-espacios de
  agregados — documentada en `contracts/designBomPrice.json`; fuera de #442.
- Vía no compuesta Go no expande parts de agregados (TS R-4 sí con estructura
  sintética) — preexistente, fuera de scope; hardware lines de agregados sí
  se incluyen.
- Orden de parts/hardware (módulo antes que agregados en Go, inverso en TS) —
  preexistente, sin impacto en cantidades/totales.

## Verificación ejecutada por el revisor (round 2, d112b71e)

- `git status` / `git log origin/feat/442-go-bom-base-parity..HEAD` → clean,
  up to date (nada sin push). Diff `a6d458c1..d112b71e`: 9 archivos, sólo F200.
- `go test ./internal/domain/... ./internal/api/ ./internal/application/` →
  ok en los tres paquetes (exit 0).
- `go test ./internal/domain/engine/ -run TestPlinthBaseParity -v -count=1` →
  PASS con 15 subtests (incluye los 2 nuevos de agregado).
- `go test ./internal/domain/engine/ ./internal/api/ -run "Layout" -count=1`
  → ok; 41 PASS con `-v` (goldens de layout verdes tras el filtrado visual).
- `DATABASE_URL=...localhost:5445 go test ./internal/storage/ -run
  "TestHardwareLineQuantityDoublePrecision|TestSeedDemoProjectResolvesRealBom"
  -count=1` → ok.
- `pnpm --filter @granete/domain test` → 97 files / 1237 tests PASS;
  `pnpm typecheck` → exit 0.
- `pnpm --filter @granete/domain exec vitest run
  src/plinthBaseParity.contract.test.ts` → 15/15 PASS.
- `gh pr checks 508 --watch` → 6/6 pass en d112b71e.
- Comparación semántica old/new del contract JSON (python): escenarios y
  catálogo originales intactos; añadidos sólo los declarados.

---

# Historial — Round 1 (a6d458c1): CHANGES_REQUESTED

**Veredicto (round 1):** CHANGES_REQUESTED

## Checkpoints (round 1)

- C1: [x] Archivos base y docs/skills presentes. `./init.sh` no re-ejecutado
  por el revisor; cobertura equivalente verificada: suites locales + CI del
  PR #508 completa en verde (incluye `go test ./...` con Postgres y
  typecheck+tests TS).
- C2: [x] 0 features `in_progress`; F200 `done` con tests asociados que pasan;
  `progress/current.md` en plantilla limpia ("Sin feature activa").
- C3: [x] Boundaries respetados: engine Go puro y tenant-agnostic (sin
  org/session en `base_treatment.go`/`kitchen_layout_base.go`/`resolve.go`);
  domain TS sin React; naming Go/TS espejo; comentarios sólo el por qué.
- C4: [x] `pnpm --filter @granete/domain test` 1235/1235; typecheck exit 0;
  storage test con Postgres real (no mock); contract fixture corre en ambos
  motores; regresión designBomPrice verde.
- C5: [ ] `progress/history.md` sin entrada para la sesión F200.

## Paridad verificada en round 1 (positivo)

- `base_treatment.go` vs `plinth.ts`: precedencia override ítem → módulo →
  `none`; B override → módulo → 100; `wall elevation → 0`; skip-if-present
  (ZOCLO/ZOCLO_PERFIL/PATAS); vueltas F088 (returnDepth = D −
  clamp(20, D·0.1, 50), mínimo 50); guard PATAS con choice; redondeos (ml a 3
  decimales, factor ≤ 0 → 1); `suggestLegCount` = `workshopRules.ts`;
  identidad sintética `{code}-zoclo-auto` / `ZOCLO-AUTO` — espejo.
- `kitchen_layout_base.go` vs `kitchenLayout.ts`/`plinth.ts`:
  `planBaseClearanceMm` = `resolveBaseClearanceMm`; `plinthSidesForPlacement`
  (gap 30, widthOf default 600, isla → L/R/B); JSON malformado falla fuerte.
- `roundHardwarePurchaseQuantity` + `HardwarePurchaseRow` = espejo exacto de
  `engine/labels.ts` / `types.ts`.
- Claim F089 verificado: `computeWallRunPlinthMap` sin callers de producción
  TS; omitirlo en Go es paridad de comportamiento.
- Vía única canónica `resolveBomCommon` + wiring con contexto por ítem y
  `customDims`; plan parseado 1×/proyecto.
- Migration 000104 (INT → DOUBLE PRECISION, down CEIL patrón 00061) + test de
  tipo de columna y round-trip 0.6 ml bajo store real.
- Contract 13/13 en ambos motores (mismo archivo JSON).

## Divergencia bloqueante hallada en round 1

TS filtra componentes ZOCLO de agregados por modo efectivo
(`bom.ts:694-699`); Go expandía `agr.Components` sin filtro en `resolve.go`
(st-agr-/mod-agr-) ni `layout.go` → pieza fantasma alcanzable por datos,
no congelada por el contract (`"agregados": []`), no declarada como decisión
de alcance. → Corregido en d112b71e (ver round 2).

## Verificación ejecutada por el revisor (round 1, a6d458c1)

- git: rama up to date, clean; diff `origin/main..HEAD` = 21 archivos, sólo
  F200 (el diffstat contra main local mezclaba #505 por desfase del main
  local).
- `go test ./internal/domain/...` → ok; `go test ./internal/api/
  ./internal/application/` → ok.
- storage focus (PG 5445) → PASS ambos tests.
- contract Go -v → 13/13; TS domain 1235 tests + typecheck exit 0; TS
  contract directo 13/13.
- `gh pr checks 508` → 6/6 pass.
- Greps: `computeWallRunPlinthMap`/`plinthRunMap` sin callers de producción;
  `filterComponentInstancesForBaseMode` TS en 3 sitios vs 2 en Go → origen del
  bloqueante.
