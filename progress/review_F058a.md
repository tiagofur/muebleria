# Review — feature F058a (sub-slice a de 3 de F058)

**Veredicto:** APPROVED

F058a extrajo 8 sub-componentes presentacionales de `ProjectsScreen.tsx`
(StatusBadge + 7 modales) sin alterar comportamiento. Refactor puro de
presentación; los 320 tests de ProjectsScreen siguen cubriendo la red de
seguridad sin cambios.

## Verificaciones automáticas

- `git status`: working tree clean.
- `git log origin/wip/perfect-app-fase-0-projects-a..HEAD`: vacío (todo pushed).
- `pnpm typecheck`: 6/6 paquetes verde (domain, excel, storage, ui, desktop, web).
- `pnpm test`: domain 217/217, storage 51/51, excel 25/25, **ui 320/320**,
  desktop 9/9, web 185/185.
- `./init.sh`: "Entorno listo" (exit 0).
- `pnpm visual` (Playwright): 6/6 verde, sin re-baseline.

## Checkpoints

- C1: [x] Harness base + docs + skills presentes; `./init.sh` exit 0.
- C2: [x] F058 marcado `in_progress` en `feature_list.json` (coherente:
  F058a es sub-slice a de 3, queda b/c). Solo una feature in_progress.
  Tests asociados a features `done` siguen pasando.
- C3: [x] Boundaries respetados (ver §Boundary check más abajo).
- C4: [x] `pnpm test` 100% verde. No toca export ni storage ni golden del motor.
- C5: [x] Branch pushed y limpia. `progress/current.md` describe la sesión
  activa (nota: cabecera dice "PARCIAL" pero el commit cc8b7d1 cerró los 3
  modales pendientes — cosmético, no bloqueante; quien cierre F058 debería
  refrescar el archivo).

## Boundary check (regla dura)

Los 8 sub-componentes solo importan de:
- `react` / `lucide-react`
- `@muebles/domain` (tipos y helpers de dominio)
- `../../common` (Modal)
- `../../catalogs/CatalogPicker` (MetaModal + AddItemModal)
- `../projectHelpers` (StatusBadge, MetaModal, AddItemModal, TemplatePickerModal)

`grep` de violaciones (`apps/web`, stores, `@/store`): **0 resultados**.
Ningún sub-componente depende de stores de apps/web. Confirmado.

## data-testid (regla dura)

`comm -23` entre testid de `main` y testid de `HEAD` (ProjectsScreen +
components/): **vacío**. Ningún test-id perdido. Los críticos preservados:

- `project-customer-picker` → ProjectMetaModal
- `project-owner-select` → ProjectMetaModal
- `add-item-category-cascade` → ProjectAddItemModal
- `add-item-module-picker` → ProjectAddItemModal
- `add-item-measure-preset` → ProjectAddItemModal
- `template-picker-list` / `template-pick-${id}` → ProjectTemplatePickerModal
- `from-template-name` / `from-template-customer` → ProjectTemplatePickerModal
- `template-management-list` / `delete-template-${id}` → ProjectTemplatesManagementModal
- `project-reopen-confirm` → ProjectConfirmReopenModal
- `save-as-template-name` → ProjectSaveAsTemplateModal

## CSS (regla dura)

`git diff main...HEAD -- packages/ui/src/projects/projects.css`: vacío.
No se inventaron clases; todas las usadas (`status-badge`, `template-picker-list`,
`catalog-form__field`, `project-editor__grid`, `btn--danger`, etc.) ya existían.

## Comportamiento (regla dura)

- Patrón `prevOpen = useRef(open)` + `useEffect` con guard `!prevOpen.current && open`
  replica el reset-on-open del original en los 3 modales con estado interno
  (ProjectMetaModal, ProjectAddItemModal, ProjectTemplatePickerModal,
  ProjectSaveAsTemplateModal). In-progress edits no se pisan por re-renders del padre.
- `renderMetaForm` y `renderAddItemForm` ya no existen en ProjectsScreen (no hay
  duplicación). El state interno del form/cascade/picker vive ahora dentro de
  cada modal.
- `metaDraft` en ProjectsScreen (línea 345) es el `initialDraft` que el
  orquestador computa y pasa al modal — esperado según el contrato documentado
  en ProjectMetaModal Props.

## Diseño UI/UX (aplica: refactor de modales)

- D1: [x] Variables CSS usadas (`var(--space-3)`); sin colores/espaciados hardcoded.
- D2: [x] Modales usan `<Modal size="sm|md">` con footer + backdrop + cierre
  por `onClose` (Esc y click-afuera ya provistos por Modal común).
- D3: [x] Iconos Lucide con `strokeWidth={1.5}` y `aria-hidden`
  (`Trash2` en TemplatesManagement, `LayoutTemplate` en TemplatePicker).
- D4: [x] Formularios con `<form id={formId}>` + botón submit externo vía
  `form={formId}` — preserva accesibilidad por teclado.
- D5: [x] Errores de validación via `role="alert"` (TemplatePicker) y
  `catalog-form__error` (Meta/AddItem) — consistente con el resto del app.

## Difuminado de trabajo ajeno (regla dura)

Diff `main...HEAD` toca solo:
- `packages/ui/src/projects/ProjectsScreen.tsx`
- `packages/ui/src/projects/components/{8 archivos}.tsx` (nuevos)
- `feature_list.json` (F058 pending → in_progress)
- `progress/current.md`

3 commits, todos bajo el paraguas F058a. **Sin mezcla con features ajenas.**
Branch basada en main post-F064 (correcto).

## Atajos aceptados (no son issues)

- ProjectsScreen en 2004 L (aún > 600): F058b y F058c reducirán más.
- ProjectAddItemModal en 429 L: el modal más complejo (cascade L1-L3 + presets
  + option inheritance). Aceptable según brief.
- Sin tests nuevos: refactor de presentación puro; los 320 existentes cubren.

## Notas menores (no bloqueantes)

- `progress/current.md` cabecera sigue diciendo "PARCIAL" y lista MetaModal/
  AddItemModal/TemplatePickerModal como pendientes, pero el commit cc8b7d1 los
  cerró. Quien abra F058b debería refrescar este archivo al cerrar F058 completo.

## Archivos relevantes

- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/projects/ProjectsScreen.tsx` (2793 → 2004 L)
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/projects/components/StatusBadge.tsx` (23 L)
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/projects/components/ProjectConfirmDeleteModal.tsx` (43 L)
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/projects/components/ProjectConfirmReopenModal.tsx` (48 L)
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/projects/components/ProjectSaveAsTemplateModal.tsx` (66 L)
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/projects/components/ProjectTemplatesManagementModal.tsx` (57 L)
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/projects/components/ProjectMetaModal.tsx` (310 L)
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/projects/components/ProjectAddItemModal.tsx` (429 L)
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/projects/components/ProjectTemplatePickerModal.tsx` (204 L)
