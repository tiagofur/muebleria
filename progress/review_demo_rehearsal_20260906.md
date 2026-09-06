# Review — Demo Golden Path Rehearsal post-#502 (2026-09-06)

**Veredicto:** APPROVED

Entregable: reporte de rehearsal + evidencia fresca de host + registros de sesión.
Diff: docs-only (`docs/demo/demo-golden-path-rehearsal-20260906.md` nuevo,
`progress/host_smoke_467_testup_ci.json` refrescado, `progress/current.md` e
`history.md` con la entrada de sesión). Sin código, sin migraciones, sin UI.

## Checkpoints

- C1: [x] Archivos base y docs canónicos presentes (verificado por listing).
  `./init.sh` completo no se re-ejecutó (diff docs-only); sus gates equivalentes
  sí corrieron verdes en este árbol esta sesión: `pnpm test` exit 0 y
  `GOFLAGS='-p=1' go test ./... -count=1` 11/11 packages `ok` (incl. storage y
  pilotreadiness sobre PostgreSQL real).
- C2: [x] Exactamente 1 feature `in_progress` en `feature_list.json` (F202/#460,
  preexistente); ninguna feature `done` afectada por este diff.
  `progress/current.md` describe la sesión del rehearsal y conserva el historial.
- C3: [x] Sin archivos de código en el diff → boundaries de arquitectura intactos
  por construcción (no se toca domain/ui/excel/Go/Ruby).
- C4: [x] Verificación real sobre el SHA del rehearsal (`79f45b28`):
  `pnpm openapi:check` sin drift; `pnpm typecheck` 7/7; `pnpm test` exit 0
  (re-ejecutado post-commit: storage 182, excel 93, desktop 17, mobile 73,
  ui 1592, web 424); `go test ./...` 11/11; browser gate #500/#501/#502 **5/5
  (40.3 s)** sobre Chromium+Go+PostgreSQL 16 efímero; TestUp real host
  (SketchUp 2026.2) `TC_ComponentAuthoringSmoke` **5/5, 48 assertions, 0F/0E/0S**.
  No aplica golden de export (no se toca export).
- C5: [x] Árbol limpio tras el commit (sin untracked sospechosos);
  `progress/history.md` tiene entrada de esta sesión; `feature_list.json` sin
  cambios (el rehearsal no es feature — correcto); `current.md` actualizado con
  la convención vigente del repo.

## Diseño UI/UX
- No aplica (diff docs-only; no toca `packages/ui/src/` ni `.css`).

## Notas del review

1. `progress/host_smoke_467_testup_ci.json`: el reporter de TestUp escribe
   minificado; se reformateó pretty (indent 2) para matchear el estilo del
   archivo trackeado. Contenido = corrida fresca de hoy (statistics idénticas
   5/5/48/0/0/0, timestamp/seed nuevos). Aserción programática de estadísticas
   incluida antes del reformateo.
2. El reporte cita evidencia con archivo:línea para ambos P0 (verificable) y no
   crea issues (respeta la regla del encargo: proponer, no crear).
3. Regla "trabajo no pushed" satisfecha: rama
   `docs/demo-golden-path-rehearsal-20260906` pusheada antes de este veredicto.

## Addendum — corrección documental post-feedback (2026-09-06)

Feedback del review externo del PR #570 (dos puntos, aplicados):

1. **P0-2 sin suavizar**: el verdict de manufacturing pasó de
   `YES WITH MITIGATIONS` a `YES AS LEGACY DEMO CONTINUATION, NOT YET AS
   END-TO-END CANONICAL DIGITAL THREAD`, con diagrama explícito: la doble
   liberación abre/continúa el flujo legacy pero **no prueba provenancia exacta
   P1/R2 → BOM**. Executive verdict, fila 23 de la tabla y mitigaciones
   actualizadas en el mismo sentido.
2. **Antigüedad de evidencia host**: filas 7/10 pasan a `PASS*` = por evidencia
   previa vigente (código sin cambios desde PR #564); footnote aclara que el
   único host fresco de la sesión fue `TC_ComponentAuthoringSmoke` y que
   rehearsal host fresco de hardware/preflight/overlay queda pendiente.

Docs-only; C1–C5 sin cambios. Veredicto se mantiene: APPROVED.
