# Sesión activa

**Feature:** F133 — Tipo de corte por defecto del taller (sierra | nesting)
**Estado:** done (sesión cerrada, revisada y pusheada)
**Inicio:** 2026-08-20

## Plan

1. `defaultCutStrategy?: CutStrategy` en `WorkshopSettings` (domain) + paridad Go + mappers.
2. Selector «Tipo de corte por defecto» en Ajustes → Ingeniería y Producción (patrón modo PTX).
3. Panel de Optimización: inicial `project.cutPlan?.config.cutStrategy ?? settings.defaultCutStrategy ?? 'saw-guillotine'`.
4. Selector por obra (F126) intacto; el plan generado persiste su estrategia.
5. Tests: domain, panel, settings screen.

## Bitácora

- 2026-08-20: F127 cerrada (done, review APPROVED, pushed `a163de7`). Usuario reporta
  que no encontraba el cambio sierra→nesting y pide default de taller. Diagnóstico:
  selector F126 vive en Ingeniería → tab Optimización y es por obra; el fallback para
  obras sin plan está hardcodeado a Sierra (`ProductionOrderOptimizationPanel.tsx`).
  F133 dada de alta e in_progress.
- 2026-08-20: implementación F133 completa:
  - `CutStrategy` movida a `types.ts` (re-exportada desde `optimizer/types.ts` para
    no romper imports) + `WorkshopSettings.defaultCutStrategy?` con default
    explícito `saw-guillotine` en `DEFAULT_WORKSHOP_SETTINGS` y validación en
    `resolveWorkshopSettings`.
  - Ajustes → Ingeniería y Producción: fieldset «Tipo de corte» con radios
    Sierra (guillotina) | CNC nesting + hint de precedencia; guarda en el payload.
  - Panel de Optimización: inicial `plan de la obra → defaultCutStrategy → sierra`;
    wiring ShellView (`workshopSettings.defaultCutStrategy`) → EngineeringWorkspace → panel.
  - Paridad Go: `WorkshopSettings.DefaultCutStrategy` (json `default_cut_strategy`),
    SELECT/UPSERT en `workshop_settings.go` + normalize (basura → sierra),
    migración aditiva `000064_workshop_settings_cut_strategy` (TEXT nullable).
    El handler PUT/GET decoda el struct directo — sin cambios de API.
  - Deuda detectada (fuera de scope): `ptxExportMode`/`defaultSawKerfMm`/trims/deduct
    NO tienen paridad Go (la sesión PTX no la hizo) — en modo server se pierden al
    recargar. Anotado para follow-up; no mezclado acá.
  - Tests: domain +4, storage +3, ui +5 (settings + panel), web +2 (payloads
    actualizados con el campo nuevo). Suite 2391, typecheck 7/7,
    `go test` storage/domain/api verdes (normalize table-driven).

## Incidente y split de commits

El primer commit de F133 (`4fbfe80`) mezcló trabajo PTX/settings que apareció en
el working tree en paralelo (del taller). Se partió en `abbcb10` (trabajo del
taller, verde standalone) + `997bf3b` (F133 pura); reviewer verificó split exacto
(diff vacío vs 4fbfe80) y se force-pusheeó. Detalle en history.md (F133).

## Siguiente

F128 — Motor de resolución de perforaciones (placements + perfiles F127 →
agujeros por pieza). Follow-ups anotados: paridad Go de settings PTX,
`btn--secondary` del panel.
