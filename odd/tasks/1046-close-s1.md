# ODD — #1046 cierre de S1 (gate de cotización, prueba PG, browser proof)

- Issue: https://github.com/tiagofur/muebleria/issues/1046 (`status:approved`)
- Base: `origin/main` @ `affdcfc4` — Rama `feat/1046-close-s1`
  (worktree `muebles-worktrees/1046-close-s1`, escritor único).
- Alcance: el slice de cierre resultante de la auditoría 2026-10-07
  (G1+G5+G2+G3). El ciclo S1/S2/S3 ya estaba mergeado (#1051/#1098/#1101 +
  #1146/#1154/#1157/#1175); este slice cierra las aceptaciones pendientes.

## Cambios

1. **G1 (fix de raíz)**: el gate de precio y el picker de ítems consumen los
   roles de placements por grupo (`optionGroupHelpers.collectComponentRoles`
   lee `overrides.hardwarePlacements` — la misma traversal que
   `collectModuleOptionRoles`); sin catálogo de componentes ya no se ocultan.
   Antes: un grupo `required` consumido sólo por un placement no bloqueaba el
   preview de precio ni aparecía en el picker, pero sí bloqueaba export.
2. **G5**: hint de miembros con costo unitario compartido
   (`hardwareGroupMembersHint`) en el placements editor y la lista en
   cantidad del agregado; copy del Modo unificado
   (`Grupo de opciones / Herraje específico` en el panel de módulos);
   assertion del costo en tests.
3. **G2**: `TestQuoteCommercialSnapshot_HardwareGroupChoiceChangesExactDemandAndCost`
   — delta EXACTO Blum (160/728) vs económica (48/560) contra PostgreSQL real
   bajo el rol de app, vía líneas por rol + choices a nivel proyecto, y la
   Q1 no sigue cambios posteriores del default.
4. **G3**: `tests/organization/hardware-group-quote.spec.ts` — browser proof
   E2E real (Chromium+Go+PG): picker del grupo en la línea → elegir Blum →
   Q1 congela → totales visibles ($340 venta, Herrajes $160.00 MXN) y
   readback del descriptor congelado.

## Seguimiento fileado aparte

- #1209 — acabados de herraje al snapshot comercial (v2).
- #1210 — demanda de herrajes por placements de módulo/estructura sin línea
  en cantidad no cotiza (gap demanda→BOM del survey; incluye la nota del
  picker sin `catalogAgregados`).

## Verificación

- V0: gofmt en el test tocado; `go vet` OK; tsc de tests sin nuevos errores.
- V1: vitest workspace COMPLETO verde (domain 1792, storage 268, ui 2214,
  web 600, excel 695, desktop 17, mobile 87 + tests raíz 16); `pnpm typecheck`
  OK; optionGroupHelpers 22/22 (4 nuevos), HardwarePlacementsEditor/Agregado/
  Module 77/77, partDrillingResolver 28/28 (paridad #4 nueva); suite backend
  storage COMPLETA en contenedor desechable: ok 532.8s (incluye el delta
  #1046). Rama rebased sobre main 8b58a3b6 (#1208 mergeado, sin conflictos).
- V2: el browser proof ES V2 (host real Chromium+Go+PostgreSQL):
  `organization-browser-gate.sh` del spec nuevo → 1 passed.

## Resultado

IMPLEMENTED_PENDING_REVIEW — 2 commits (fix UI + pruebas de cierre).
Aceptaciones S1: #1-#5 demostradas; #6 (fixture compartido TS↔Go en
contracts/) queda nombrado como restante en el PR → `Delivery: partial`.
