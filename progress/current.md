# Sesión

**Feature cerrada:** F144 — proyectar_precision_dims_undo (#310 P3D-1b, meta #308 etapa E4)
**Inicio:** 2026-08-22 · **Cierre:** 2026-08-22
**Subplan (SDD):** https://github.com/tiagofur/muebleria/issues/310#issuecomment-5383131745

## Resultado

Precisión 5★ del North Star §10.2/§12 sobre la selección de F143: **nudge de
teclado** (flechas mueven unidades por su muro e islas en plano; Shift = paso
grueso ×5; paso configurable; ráfaga coalescida en UNA entrada de undo; la
órbita por teclado cede cuando hay selección; flechas dentro de tabs
pertenecen al roving tabindex). **Snap configurable** por taller
(localStorage `proyectar.precision.v1`): paso nudge, snap de muro on/off,
umbral, gap y grilla de islas — cableado a drag/place/guías vía
`useStudioPrecisionSettings`. **Fit selection**: cámara `fit-selection` que
encuadra la selección (botón Enfocar + tecla F, misión matemática de presets;
funciona en modo lectura). **Drag del grupo**: el studio traduce el delta del
módulo tomado a sus compañeros seleccionados del mismo muro / islas vía
`nudgeSelectionCommand` (all-or-nothing, `draggingInvalid` si bloquea). **Offsets
mm** commitean en blur/Enter (una intención por edición). **Dimensiones libres
por ítem**: `ProjectItem.customDims` + `resolveItemDims` (fuente única:
a medida → preset → módulo) + `resolveBom(dimsOverride)` threadeado a
pricing/cut/labels/exportIssues/drilling/assemblySheets/moduleLabels/plinth/
productionElevations/partExecution → BOM, corte, precio, 3D y etiquetas quedan
conectados; presets siguen como shortcut (click limpia el override); sólo
módulos paramétricos, 50–3000 mm, inválido no commitea con mensaje que enseña;
fingerprint de productionRevision incluye customDims (diseño ⇒ stale, sin
false-stale masivo en legacy). **Undo por intención** (`studioHistory.ts`
puro): entradas etiquetadas ("Deshacer: Mover 2 muebles (Ctrl+Z)") que
restauran layout E ítems completos, coalescing por ventana, límite 30,
redo-clear; decisión documentada de no migrar al `CommandManager` genérico
(estado en el padre vía callbacks).

## Verificación (evidencia)

- `pnpm test` exit 0 — 2.916 tests (domain 995 · storage 153 · excel 89 ·
  ui 1.316 · mobile 45 · desktop 17 · web 301); `pnpm typecheck` exit 0.
- Smoke WebGL Playwright 3/3 (F144: nudge ×3 → undo único restaura → a medida
  800 mm commitea → Enfocar → undo restaura medida; screenshot
  `test-results/proyectar-precision.png` revisado).
- Review: **APPROVED** con 4 hallazgos encontrados y corregidos durante la
  review (undo que no borraba customDims, flechas vs roving tabindex de tabs,
  Esc del popover de precisión, crash con módulo indefinido) —
  `progress/review_F144.md`.

## Siguiente etapa

#313 (P3D-7) adelantado — contract tests diseño→BOM→precio→producción
(congela el `dimsOverride` en fixtures de paridad). Después #311 (P3D-4).
