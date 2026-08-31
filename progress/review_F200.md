# F200 — Paridad Go del tratamiento de base: ZOCLO-AUTO y effective base context (#442)

Fecha: 2026-08-30 · Rama: `feat/442-go-bom-base-parity` (worktree aislada `../muebles-442`, base `origin/main` @ d48b7fc9) · Status: done (pendiente review/merge)

## Problema

El fix #441 (P0-2a) llevó la variable `B` a las fórmulas Go, pero el tratamiento de base seguía divergiendo de TS: Go no filtraba componentes ZOCLO por modo en la vía BOM, no sintetizaba `ZOCLO-AUTO`, ignoraba `project_items.base_mode` (persistido pero sin consumo) y no podía representar el ml fraccional del perfil (`quantity INT`). Resultado: cotización, layout y salida de manufactura discrepaban para el mismo mueble.

## Solución

- **`base_treatment.go`** (nuevo): espejo Go de `packages/domain/src/plinth.ts` — modos, resolución de modo/B con contexto, `applyBaseTreatment` (síntesis frontal + vueltas F088 + guard PATAS), `applyBaseModeToHardwareLines` (ml/patas), `suggestLegCount`, `plinthStripMeters`, `plinthReturnDepthMm`.
- **`kitchen_layout_base.go`** (nuevo): lector mínimo del plan (walls/placements/baseClearanceMm del espejo active-space) + `ResolveBaseContextForItem`. JSON malformado falla fuerte (sin fallback silencioso).
- **`resolve.go`**: vía canónica única `resolveBomCommon`; `ResolveBomWithContext` nuevo; filtrado de instancias ZOCLO (estructura Y módulo) por modo efectivo; tratamiento aplicado antes de resolver ids.
- **Cableado**: `CalcProjectBreakdown`, `GenerateCutRows`, `GenerateHardwareList`, `collectUsedUnitPrices` resuelven con contexto por ítem (el plan se parsea una vez por proyecto). Cut list ahora también pasa `customDims` (divergencia de la misma clase, TS `cut.ts` ya lo hacía).
- **Float64**: `HardwareLine.Quantity`, `ResolvedHardwareLine.Quantity`, `HardwarePurchaseRow` (+ `purchaseQuantity`/`purchasePackages`/`packageSize` con techo a barras, espejo de `roundHardwarePurchaseQuantity` TS).
- **Migration 000104**: `hardware_lines.quantity INT → DOUBLE PRECISION` (patrón 00061). Mantenida `CHECK (quantity > 0)`.

## Paridad

`contracts/plinthBaseParity.contract.json` (`granete.plinthBaseParity.v1`), 13 escenarios: síntesis, alias FRENTE, anti-phantom, override ítem none/legs, guard PATAS, perfil ml 0.6, B del plano 120, default 100 sin baseMode de módulo, vueltas F088 (muro/insula), 6 patas >600, wall elevation B=0. Consumido por `packages/domain/src/plinthBaseParity.contract.test.ts` y `backend-go/internal/domain/engine/plinthBaseParityContract_test.go`. Regla del contract: si un motor diverge, se alinea el motor — nunca el expected. Los expecteds se validaron contra el motor TS de referencia ANTES de implementar Go.

## Alineación explícita

- **Organization Foundation v2 / multi-taller**: el engine sigue puro y tenant-agnostic; catálogo org-scoped inyectado vía store/RLS. Sin handlers, OpenAPI, sesiones ni UI — cero solapamiento con las sesiones en curso de #458/#460. Sin tablas nuevas (sólo widen de columna; 000094 RLS intacto).
- **Plugin SketchUp**: contratos `sketchupAuthoringResolve` y `sketchupLayoutTransform` intactos (goldens sin regenerar); `B` sigue siendo variable de fórmula server-side, no un typed parameter (fail-closed #477/#483 respetado). La vía layout visual no sintetiza (igual que TS).
- **F089 (merge de runs) fuera de alcance a propósito**: ningún caller de producción TS pasa `plinthRunMap`; paridad = mismo comportamiento.

## Verificación

- `go test ./internal/domain/...` verde (contract 13/13 + unitarios: wiring CalcProjectBreakdown, wall elevation, layout malformado, patas/ml, barras).
- `go test ./internal/storage/ -run TestHardwareLineQuantityDoublePrecision` verde sobre Postgres 15 fresco (throwaway DB): 000104 aplica, tipo `double precision`, round-trip 0.6 ml por el store.
- `go test ./...` verde **salvo** fallo PRE-EXISTENTE de `00102_support_session_credential_epoch` (trigger `protect_support_session_scope`), reproducido con stash en main limpio — pertenece al programa de sesiones (#458/#460), no tocado por F200.
- `pnpm test` verde (3354 tests) · `pnpm typecheck` exit 0.

## Pendiente / follow-up sugerido

- La duplicación UI del mapeo baseMode→rol (`moduleRolePickers.ts` repite `collectUsedOptionRoles`) es limpieza TS separada, fuera de #442.
- El fallo local de 00102 debería reportarse a la sesión de #458 (falla también en main limpio con PG15 local).
