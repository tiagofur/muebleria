# Review — feature F110

**Veredicto:** APPROVED

Fecha: 2026-08-19

## Alcance revisado

### Primitivo nuevo

- `common/FullscreenDialog.tsx` (+ `fullscreenDialog.css`, +
  `FullscreenDialog.test.tsx`, 4 tests): mismo contrato que Modal — portal,
  `role=dialog` + `aria-modal` + `aria-labelledby`, focus trap (Tab/Shift+Tab),
  Esc, focus restore al trigger, body scroll lock. Superficie edge-to-edge
  con tokens (`--surface-sidebar`, `--text-inverse`, z `--z-modal-dialog`).
  `escapeEnabled={false}` permite delegar Esc en overlays con capas.
  Exportado de `common/index.ts` y `src/index.ts`.

### Migraciones (5 overlays)

- `users/SectorAssignment` → Modal (tenía overlay propio con header/close;
  props contract intacto, consumer UsersScreen sin cambios).
- `production/CsvExportConfigModal` → Modal (fuera listener Esc + overlay
  custom; estado/testids intactos).
- `onboarding/OnboardingTourModal` → Modal; un solo `handleDismiss` marca el
  tour como visto — sigue siendo skippable (Omitir/X/Esc/overlay), no
  bloqueante.
- `showcase/ProjectsPortfolioView` (lightbox) → FullscreenDialog; añadida
  navegación de fotos con flechas a nivel window (no colisiona con el trap
  Tab-only); botones con aria-label.
- `projects/components/ProjectPresentationMode` → FullscreenDialog con
  `escapeEnabled={false}`: un único camino de Esc (shortcuts overlay →
  onClose), sin doble manejo. Deck interno (slides, tabs, swipe) intacto.

### Limpieza

- CSS de features reducido a contenido (overlay/panel/header/footer
  eliminados en sectorAssignment.css, csvExportConfigModal.css,
  onboardingTourModal.css, projectsPortfolio.css). `.project-presentation`
  dejó de ser `position:fixed` (llena el shell). El backdrop rgba(0,0,0,0.9)
  del lightbox fue reemplazado por la superficie tokenizada del shell.

## Checkpoints

- C1: [x] `./init.sh` verde (todos los workspaces, 2026-08-19).
- C2: [x] Solo F110 en `in_progress` al revisar; `current.md` al día.
- C3: [x] Sin cambios de boundaries.
- C4: [x] Tests focales keyboard/SR por overlay: labelledby resuelve, Esc
  (incluida la capa doble de presentación), trap Tab, focus restore, botón
  close con nombre accesible. Focused: 169+19 (grupo Modal) y 71/71 (grupo
  FullscreenDialog). Suite completa verde vía init.sh.
- C5: [x] Al cierre: F110 `done`, entrada en history, commit atómico sin el
  WIP ajeno `processStage.*`, `git push`.

## Diseño UI/UX

- D1: [x] Solo tokens (sin rgba crudo nuevo; el fondo del lightbox ahora es
  token).
- D3: [x] Modales cumplen §4.3 (focus trap, Esc, backdrop accesible).
- D7: [x] Detector Impeccable: 0 hallazgos sobre packages/ui/src.
- D8: [x] A11y §4.8/§4.9: onboarding skippable confirmado por test.

## Notas

- El overlay de shortcuts dentro de PresentationMode conserva su backdrop
  local: es un overlay interno anidado, no un overlay de página; decisión
  documentada por el agente migrador y validada aquí.
