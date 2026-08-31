# Review — feature F200 (#442)

**Veredicto:** CHANGES_REQUESTED

Rama `feat/442-go-bom-base-parity` (commit a6d458c1, pushed, PR #508), base
`origin/main` @ d48b7fc9. Diff de la feature: `git diff origin/main..HEAD`
(21 archivos; el diffstat contra `main` local mezclaba #505 sólo porque el
main local estaba desactualizado — verificado, no es trabajo ajeno en la rama).

La implementación es de alta calidad y la paridad núcleo está verificada
(contract compartido 13/13 en AMBOS motores, tests reales con Postgres, CI
6/6 verde). Se rechaza por **una divergencia semántica de paridad no declarada**
(filtrado ZOCLO en componentes de agregados) y un box de C5 sin cerrar.

## Checkpoints

- C1: [x] Archivos base y docs/skills presentes. `./init.sh` no re-ejecutado
  por el revisor; cobertura equivalente verificada: suites locales (abajo) +
  CI del PR #508 completa en verde (incluye `go test ./...` con Postgres y
  typecheck+tests TS).
- C2: [x] 0 features `in_progress`; F200 `done` con tests asociados que pasan;
  `progress/current.md` en plantilla limpia ("Sin feature activa").
- C3: [x] Boundaries respetados: engine Go puro y tenant-agnostic (sin
  org/session en `base_treatment.go`/`kitchen_layout_base.go`/`resolve.go`);
  domain TS sin React; naming Go/TS espejo; comentarios sólo el por qué
  (paridad, F089 ausente, tolerancia de anchos).
- C4: [x] `pnpm --filter @granete/domain test` 1235/1235; typecheck exit 0;
  storage test con Postgres real (no mock); contract fixture del motor corre
  en ambos motores; regresión designBomPrice verde.
- C5: [ ] `progress/history.md` no tiene entrada para la sesión F200 (la
  última entrada es el cierre de F198). Agregar al cerrar la sesión.

## Paridad verificada (positivo)

- `base_treatment.go` vs `plinth.ts`: precedencia override ítem → módulo →
  `none`; B override → módulo → 100; `wall elevation → 0`; skip-if-present
  (ZOCLO/ZOCLO_PERFIL/PATAS); vueltas F088 (id `-lado-<side>`, `ZOCLO-LADO-AUTO`,
  returnDepth = D − clamp(20, D·0.1, 50), mínimo 50); guard PATAS con choice;
  redondeos (ml a 3 decimales, factor ≤ 0 → 1); `suggestLegCount` (≤600 → 4,
  >600 → 6) = `workshopRules.ts`; identidad sintética `{code}-zoclo-auto` /
  `ZOCLO-AUTO` / `-zoclo-perfil-auto` / `-patas-auto` — todo espejo.
- `kitchen_layout_base.go` vs `kitchenLayout.ts`/`plinth.ts`:
  `planBaseClearanceMm` = `resolveBaseClearanceMm`; `plinthSidesForPlacement`
  (gap 30, widthOf default 600, isla → L/R/B); JSON malformado falla fuerte
  (sin fallback silencioso).
- `roundHardwarePurchaseQuantity` + `HardwarePurchaseRow` = espejo exacto de
  `engine/labels.ts` / `types.ts` (ceil a barras con ε 1e-12, lineCost por
  purchaseQuantity).
- Claim F089 **verificado**: `computeWallRunPlinthMap` sólo se re-exporta en
  `index.ts`; ningún caller de producción TS pasa `plinthRunMap`
  (todos los `baseContextForItem(project, item[, catalog])` usan ≤3 args).
  Omitirlo en Go es paridad de comportamiento, correcto.
- Vía única canónica `resolveBomCommon` + wiring con contexto por ítem y
  `customDims` en `CalcProjectBreakdown`/`GenerateCutRows`/
  `GenerateHardwareList`/`collectUsedUnitPrices`; plan parseado 1×/proyecto.
- Migration 000104 (INT → DOUBLE PRECISION, down con CEIL best-effort patrón
  00061) + test de tipo de columna y round-trip 0.6 ml bajo store real.
- Contract `granete.plinthBaseParity.v1` consumido del MISMO archivo JSON por
  ambos tests (`os.ReadFile ../../../contracts/...` en Go, `import ...json`
  en TS). 13/13 en Go y 13/13 en TS.

## Divergencia bloqueante: filtrado ZOCLO de componentes de agregados

TS filtra las instancias de componentes ZOCLO de los **agregados** por modo
efectivo — `packages/domain/src/engine/bom.ts:694-699`
(`filterComponentInstancesForBaseMode(res.components ?? [], ...)` dentro del
loop de unidades de agregado). Go no lo hace al expandir `agr.Components`
(`Agregado.Components` es `[]ComponentInstance`, mismo modelo que TS):

1. `backend-go/internal/domain/engine/resolve.go` — `expandComposedModulePartsWithDims`,
   agregados de estructura (prefijo `st-agr-`) y de módulo (prefijo `mod-agr-`):
   `expandComponentInstances(agr.Components, ...)` **sin**
   `filterInstancesForBaseMode`.
2. `backend-go/internal/domain/engine/layout.go:791` — vía espacial:
   `expandLayoutInstances(agr.Components, ...)` **sin** filtro.

Con un agregado que instancie un componente con `optionRoles[0] == "ZOCLO"` y
modo efectivo ≠ `plinth_board`, TS omite la pieza y Go la emite (pieza fantasma
→ BOM/costo divergentes). No hay validación TS que impida rol ZOCLO en
componentes de agregados (verificado en `validate.ts`/`agregados.ts`), y el
contract no lo congela (`"agregados": []`). Esta decisión de alcance no fue
declarada en la nota del implementador (que declara "estructura Y módulo").

## Cambios requeridos

1. **Filtrar ZOCLO por modo efectivo en los componentes de agregados**:
   envolver `agr.Components` con `filterInstancesForBaseMode(agr.Components,
   catalog, baseMode)` en los sitios citados de `resolve.go` (st-agr-/mod-agr-)
   y `layout.go:791`, y añadir al contract un escenario con un agregado que
   instancie `comp-zoclo` (el catálogo del fixture ya define el componente)
   con modo `none`/`legs` para congelar la paridad en ambos motores.
2. **Agregar la entrada de la sesión F200 a `progress/history.md`** al cerrar
   (C5).

## Observaciones menores (no bloqueantes)

- Guard PATAS: TS usa truthy sin trim (`plinth.ts:558-563`,
  `optionChoices?.[PATAS_ROLE]`), Go trimea (`base_treatment.go:331`).
  Divergencia observable sólo con un choice whitespace-only (degenerado);
  alinear o documentar como decisión deliberada en el contract/nota.
- `plinthSidesForPlacement` Go trata un muro con `lengthMm <= 0` como
  "no encontrado" (→ expuesto); TS usaría length 0 (→ cubierto). Degenerado.
- La vía no compuesta Go no expande parts de agregados (TS R-4 sí, con
  estructura sintética). Divergencia PREEXISTENTE, fuera del scope #442 —
  registrarla como follow-up si se quiere paridad total de agregados.
- Orden de parts/hardware (módulo antes que agregados en Go, inverso en TS)
  — preexistente, sin impacto en cantidades/totales.

## Verificación (nota del implementador — referencia)

- `go test ./internal/domain/...` verde (contract 13/13 + unitarios: wiring CalcProjectBreakdown, wall elevation, layout malformado, patas/ml, barras).
- `go test ./internal/storage/ -run TestHardwareLineQuantityDoublePrecision` verde sobre Postgres 15 fresco (throwaway DB): 000104 aplica, tipo `double precision`, round-trip 0.6 ml por el store.
- `go test ./...` verde **salvo** fallo PRE-EXISTENTE de `00102_support_session_credential_epoch` (trigger `protect_support_session_scope`), reproducido con stash en main limpio — pertenece al programa de sesiones (#458/#460), no tocado por F200.
- `pnpm test` verde (3354 tests) · `pnpm typecheck` exit 0.

## Verificación ejecutada por el revisor

Comandos corridos en `/Users/tiagofur/dev/carpinteria/muebles-442` (2026-08-30):

- `git status` / `git log origin/feat/442-go-bom-base-parity..HEAD` → working
  tree clean, rama up to date (nada sin push). Commit propio único a6d458c1
  sobre origin/main d48b7fc9; diff `origin/main..HEAD` = 21 archivos, sólo F200.
- `go test ./internal/domain/...` → ok (`internal/domain`, `internal/domain/engine`).
- `go test ./internal/api/ ./internal/application/` → ok.
- `DATABASE_URL=...localhost:5445 go test ./internal/storage/ -run
  "TestHardwareLineQuantityDoublePrecision|TestSeedDemoProjectResolvesRealBom" -v -count=1`
  → ambos PASS (migraciones hasta 000104 aplicadas en DB fresca).
- `go test ./internal/domain/engine/ -run "TestPlinthBaseParity|..." -v -count=1`
  → `TestPlinthBaseParity_SharedContract` PASS con los 13 subtests +
  unitarios (wiring CalcProjectBreakdown, wall elevation, layout malformado).
- `pnpm --filter @granete/domain test` → 97 files / 1235 tests PASS;
  `pnpm typecheck` → exit 0 (7 proyectos).
- `pnpm --filter @granete/domain exec vitest run src/plinthBaseParity.contract.test.ts`
  → 13/13 PASS (mismo `contracts/plinthBaseParity.contract.json`).
- `go test ./internal/storage/ -run "TestSupportSessionEpochMigration" -v -count=1`
  → PASS local en esta corrida; el fallo local 00102 reportado no se reprodujo
  en estos subtests y no afecta a F200.
- `gh pr checks 508` → 6/6 pass (Go Backend Tests, TypeScript, SketchUp Ruby
  ×3, Validate Feature List).
- Greps de paridad: `computeWallRunPlinthMap`/`plinthRunMap` sin callers de
  producción TS (sólo re-export en `index.ts`); `filterComponentInstancesForBaseMode`
  aplicado en TS en 3 sitios vs 2 en Go → origen del cambio requerido 1.
