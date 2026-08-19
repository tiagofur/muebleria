# Review — feature F058b

**Veredicto:** APPROVED

Sub-slice b de 3 de F058. Extrajo `ProjectDetailView.tsx` (chrome sticky +
body 2 columnas) de `ProjectsScreen.tsx`. Refactor de presentación puro: sin
lógica nueva, sin tests nuevos, sin cambios de comportamiento.

## Checkpoints

- C1: [x] Harness intacto (init.sh verde).
- C2: [x] Estado coherente. 320/320 tests ui pasan.
- C3: [x] Arquitectura respetada. ProjectDetailView solo importa de
      `@muebles/domain`, `lucide-react`, primitivas comunes de `../../common`,
      paneles hermanos y `projectHelpers`. **No** importa de `apps/web`, ni
      stores, ni electron/fs/xlsx. Lo verifiqué con grep: 0 hits.
- C4: [x] Verificación real: typecheck 6/6, tests (domain 217 + storage 51 +
      excel 25 + ui 320 + desktop 9 + web 185) todos verde.
- C5: [x] Sesión cerrada limpia: `git status` limpio, branch pushed a origin,
      `git log origin/wip/perfect-app-fase-0-projects-b..HEAD` vacío.

## Git / atomicidad

- [x] Branch `wip/perfect-app-fase-0-projects-b` pushed, HEAD == origin.
- [x] Commit `ba7b78b` atómico: exactamente 3 archivos, todos de F058b. No
      mezcla trabajo ajeno (causa del incidente 3D de 2026-07, descartada).
- [x] diff stat: `ProjectsScreen.test.tsx +7/-2`, `ProjectsScreen.tsx` 
      -1015 (2004 → 1075 L), `ProjectDetailView.tsx` +1262 (new).

## data-testid preservation

- [x] Comparé el set de `data-testid="…"` del ProjectsScreen.tsx previo al
      commit (HEAD~1) contra la unión (ProjectsScreen + ProjectDetailView)
      post-extracción. **21 → 21, sin pérdida ni añadidos.** Idéntico.
      (`project-detail`, `project-detail-chrome`, `project-detail-total`,
      `project-chrome-export`, `project-chrome-present`, `project-mark-produced`,
      `project-reopen`, `project-owner-label`, `project-level-options`,
      `project-measure-defaults`, `project-view-3d-run`, `project-item-*`,
      `view-3d-btn-*`, `breakdown-loading`, `breakdown-error`,
      `project-material-summary`, `project-sheet-estimate`,
      `project-nesting-import`, `project-nesting-file`, etc.)

## Comportamiento / state

- [x] State solo del detalle que tenía sentido mover: ninguno se movió
      (correcto — todo el state del detalle o es derivado de props o se
      computa inline). El `updateMeasureDefaults` helper se mudó con la
      sección que lo usa (acción local pura que llama al callback shell).
- [x] State compartido con el orquestador quedó como props controladas:
      - `removeConfirm` (`confirmRemoveItemId` + 3 handlers) — el orquestador
        lo resetea; el modal de 3D y add-item viven en el padre.
      - `viewer3D` handlers (`setViewerItem`, `setViewerQuoteRun`,
        `setShow3DModal`) — el `Project3DModal` vive en ProjectsScreen.
      - `addItemModalOpen` + `onOpenAddItemModal` — `ProjectAddItemModal`
        vive en ProjectsScreen.
      Coincide con los atajos marcados como correctos en el brief.

## Test de layout

- [x] El único test modificado (`keeps project options inside main column so
      totals stay sidebar`) ahora lee `components/ProjectDetailView.tsx` en
      lugar de `ProjectsScreen.tsx`. Sigue validando el orden DOM
      (main antes que opciones e ítems; aside de totales al final). El
      comentario del commit explica el motivo del cambio. Apropiado.

## Atajos evaluados

Los atajos que NO count (correctamente ignorados):
- ProjectDetailView 1262 L > 800: es chrome+body completo, F058c puede
  partirlo. OK.
- ProjectsScreen 1075 L > 600: F058c (separar lista) reduce más. OK.
- Sin tests nuevos: refactor de presentación. OK.

Los atajos que SÍ count (todos descartados):
- Tests rotos: NO — 320/320 ui verde.
- Typecheck roto: NO — 6/6 verde.
- Playwright roto: NO — 6/6 sin re-baseline.
- Trabajo no pushed: NO — HEAD == origin, working tree clean.
- ProjectDetailView importa de apps/web: NO — 0 imports sospechosos.
- data-testid perdido: NO — 21/21 preservados.

## Notas

- F058c pendiente: separar la lista (`renderList` → `ProjectsListView`).
  Eso debería llevar ProjectsScreen claramente bajo 600 L.
- El patrón de extracción (import + JSX controlado + state de apertura en
  el orquestador) es consistente con F058a.
