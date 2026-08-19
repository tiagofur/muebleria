# Review — feature F058c

**Veredicto:** APPROVED

Sub-slice c de 3 de F058 (CIERRA F058). Extrajo `renderList()` de
`ProjectsScreen.tsx` a `ProjectsListView.tsx`. Refactor de presentación
puro: sin lógica nueva, sin tests nuevos, sin cambios de comportamiento.
Idéntico en espíritu a F058a/F058b (mismo patrón de extracción).

## Verificaciones automáticas

- `git status`: working tree clean.
- `git log origin/wip/perfect-app-fase-0-projects-c..HEAD`: vacío (todo pushed).
- `pnpm typecheck`: 6/6 paquetes verde (domain, excel, storage, ui, desktop, web).
- `pnpm test`: domain 217/217, storage 51/51, excel 25/25, **ui 320/320**,
  desktop 9/9, web 185/185. (El "Error: net" en stderr de
  workspaceStore.test.ts es el log esperado del test de fallback — el test
  `falls back to current authUser on fetch failure` pasa ✓.)
- `./init.sh`: "Entorno listo" (exit 0).
- `pnpm visual` (Playwright baseline): **6/6 verde, sin re-baseline.**

## Checkpoints

- C1: [x] Harness intacto (`./init.sh` exit 0).
- C2: [x] Estado coherente. ui 320/320. Red de seguridad sin cambios.
- C3: [x] Boundaries respetados (ver §Boundary check abajo).
- C4: [x] `pnpm test` + `typecheck` + `init.sh` 100% verde.
- C5: [x] Branch pushed y limpia; `git log origin/..HEAD` vacío.

## Git / atomicidad

- [x] Branch `wip/perfect-app-fase-0-projects-c` pushed, HEAD == origin.
- [x] Commit `94b8391` atómico: exactamente 2 archivos, ambos de F058c.
      No mezcla trabajo ajeno (causa del incidente 3D de 2026-07, descartada).
- [x] diff stat: `ProjectsScreen.tsx` 1075 → 951 L (-124), `ProjectsListView.tsx`
      +186 (new). Total +205/-143.

## Boundary check (regla dura)

`ProjectsListView.tsx` solo importa de:
- `react` (tipo `ReactNode`)
- `lucide-react` (iconos)
- `@muebles/domain` (tipos `Customer`, `Project`, `ProjectTemplate`)
- `../../common` (`EmptyState`, `SearchInput`)
- `../projectHelpers` (`resolveCustomerName`, `formatIsoDate`)
- `./StatusBadge` (hermano)

`grep` de `apps/web`, `electron`, `fs/`, `xlsx` (import) en la carpeta
`projects/components/`: **0 hits relevantes**. (El único match de "xlsx"
es el string literal `'Exportar cut-list Optimizer (.xlsx)'` en
`ProjectDetailView.tsx:392` — label de UI, no import; pertenece a F058b,
fuera de scope.)

## data-testid preservation

Set de `data-testid` del bloque `renderList` antes (ProjectsScreen.tsx @HEAD~1)
vs ahora (ProjectsListView.tsx): **idéntico, 4 → 4, sin pérdida ni añadidos.**
- `new-from-template-btn` ✓
- `manage-templates-btn` ✓
- `empty-from-template-btn` ✓
- `project-card-${project.id}` (template literal) ✓

Nota: `projects-loading` permanece en `ProjectsScreen.tsx:740` — correcto,
pertenece al gate de `loading` de toda la pantalla, no a la vista de lista.

## Equivalencia semántica del JSX extraído

Comparé el cuerpo de `renderList()` (HEAD~1) contra `ProjectsListView.tsx`.
El JSX es **idéntico** salvo el wiring de props (patrón correcto de extracción):

- Callbacks inline → props: `startCreate`→`onNewProject`,
  `startFromTemplate`→`onFromTemplate`, `setSearch`→`onSearchChange`,
  `openDetail`→`onOpenProject`, `() => setTemplatesManagementOpen(true)`→
  `onManageTemplates`, `() => setSearch('')` (Limpiar filtros) →
  `() => onSearchChange('')`.
- Checks de permiso compuestas se parten en flags pre-computadas:
  `canMutate && projectTemplates && projectTemplates.length > 0 && onCreateFromTemplate`
  → `canMutate && hasTemplates && hasCreateFromTemplate`, donde
  `hasTemplates = projectTemplates && projectTemplates.length > 0` (L59-60) y
  `hasCreateFromTemplate={!!onCreateFromTemplate}` / `hasDeleteTemplate={!!onDeleteTemplate}`
  se setean en `ProjectsScreen.tsx:726-727`. **Booleanamente equivalente**
  en los 3 botones (new-from-template, manage-templates, empty-from-template).

## Diseño UI/UX

No aplica nuevos estilos: reusa clases CSS existentes
(`catalog-page__*`, `btn`, `project-card__*`) y primitivas comunes
(`EmptyState`, `SearchInput`). Iconos Lucide con `strokeWidth={1.5}` y
`aria-hidden` preservados. Sin hardcoded colors/spacing (solo
`var(--space-3)` inline, ya presente en el original).

## Nota para el líder/coordinador (no bloqueante para F058c)

F058 queda funcionalmente completo (lista + detalle + 8 modales extraídos,
ProjectsScreen 2793 → 951 L), pero **`feature_list.json` aún marca F058
`status: "in_progress"`** (L1145). Además, los nombres reales de archivos
(`ProjectsListView.tsx`, `ProjectDetailView.tsx`) difieren de los nombres
del acceptance criteria original (`ProjectsListScreen`, `ProjectDetailScreen`,
`ProjectExportsPanel`), y el `ProjectExportsPanel` (<300 L) no se extrajo
como archivo separado — la toolbar de exports vive dentro de
`ProjectDetailView.tsx`. Estos son temas de **cierre de feature F058** que
escapan al scope de este sub-slice c (que es un refactor de presentación
auto-contenido y correcto). Recomendación: quien cierre F058 debería (a)
marcar `status: "done"` en `feature_list.json` y (b) decidir si relaja los
nombres de acceptance o abre un follow-up para el `ProjectExportsPanel`.

## Conclusión

Extracción limpia, equivalente, verde en todos los gates. Aprobado.
