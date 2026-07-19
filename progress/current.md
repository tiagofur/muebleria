# Sesión actual

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch:** `wip/ui-fase-0-tokens-botones` (basada en `main`)
- **No usar:** `muebles-orig` para features nuevas

## Hecho en esta pasada (2026-07-19) — UI Review Fase 2

**Iniciativa:** Review completo UX/UI (plan aprobado por usuario en 4 fases).
**Branch:** `wip/ui-fase-0-tokens-botones` (continuación de Fase 0 + 1)

Fase 2 — **Reorganizar navegación y flujos** (P1 visible).

**Decisiones aprobadas:**
- Home polimórfico: agregar nav id `production` (Cola) propio para
  `roleUsesProductionQueue`. `home` siempre es Dashboard para todos los roles.
- Exports de Projects: Opción B adaptativa — primary Optimizer + menú
  "Más exports ▾" para los 6 restantes agrupados por Producción/Comercial.
- Crear `DropdownMenu` reusable en `common/` para menús contextuales futuros.
- Actualizar `design.md` completo (§4.1 + §6) con las 13 pantallas reales.

**Cambios:**

- **`design.md §4.1`** — actualizada la tabla nav canónica: 3 secciones
  (TRABAJO/INGENIERÍA/CONFIG) con 13 items en lugar de las 2 secciones y 8
  items documentados. ASCII diagram actualizado con la nueva sección
  INGENIERÍA y la nueva nav Cola (condicional por rol). Tabla de
  vocabulario ampliada con Vitrina, Cola, Estructuras, Componentes, Ajustes.

- **`design.md §4.2.1`** (nueva) — regla canónica de patrón por tipo de entidad:
  entidad plana = tabla-expand; entidad compleja = card-detalle;
  comercial = card-grid. Documenta que Components/Structures están
  pendientes de migrar a card-detalle en Fase 3.

- **`design.md §6`** — ampliada de 6 a 13 subsecciones (12 nav + Login/Register):
  - §6.6 Vitrina (showcase, F040/F043)
  - §6.7 Cola de producción (production nav — nuevo)
  - §6.8 Estructuras (structures, F049)
  - §6.9 Componentes (components)
  - §6.10 Ajustes (settings, F031)
  - §6.11 Usuarios (users, F026)
  - §6.13 Registro (RegisterScreen)
  - §6.1 Home: documentadas variantes `homeMode` (default/sales/engineering)
  - §6.2 Cotizaciones: documentada la nueva agrupación de exports
  - §6.3 Muebles: corregido de "sección TRABAJO" → "INGENIERÍA"

- **`packages/domain/src/rbac.ts`** — `navIdsForRole` ahora incluye `'production'`
  cuando `roleUsesProductionQueue(role)` (solo `produccion`). Guest no lo
  recibe (no hay cola localmente).

- **`packages/ui/src/shell/AppShell.tsx`**:
  - `'production'` añadido al `AppNavId` (union type).
  - Sección TRABAJO ahora tiene 5 items: Inicio, Cotizaciones, Clientes,
    Vitrina, Cola (icono `Factory`).
  - Filtrado normal vía `allowedNavIds`: el sidebar solo muestra Cola si el
    rol tiene el permiso.

- **`apps/web/src/routes.ts`** — `production: '/produccion'` añadido a
  `NAV_PATHS`. Excluido de `EntitySection` (no es entidad con deep-link `:id`).

- **`apps/web/src/App.tsx`** — routing simplificado:
  - `navId === 'home'` SIEMPRE monta Dashboard (ya sin el if/else
    polimórfico). Se eliminó el branch `useProductionQueue ? ProductionQueue :
    Dashboard`.
  - `navId === 'production' && useProductionQueue` monta ProductionQueue.

- **`packages/ui/src/common/DropdownMenu.tsx`** (nuevo) — componente menu
  contextual accesible: trigger button + popup con role="menu"/"menuitem",
  secciones opcionales con labels, click-outside, Esc, flechas, Enter.
  No depende de Radix ni libs externas.

- **`packages/ui/src/common/dropdownMenu.css`** (nuevo) — estilos con tokens.

- **`packages/ui/src/projects/ProjectsScreen.tsx`** — chrome reorganizado:
  - **Exportar Optimizer** (`btn--primary`): directo, mantiene `data-testid
    project-chrome-export`. Disabled cuando productionExportDisabled.
  - **Más exports ▾** (`DropdownMenu` con trigger `btn`): secciones
    Producción (Herrajes, Etiquetas, Pack) + Comercial (Cotización, PDF
    listado, PDF resumen). Cada item disabled según sus condiciones.
    Las secciones solo se renderizan si tienen items (props presentes).
  - Eliminados los 6 botones de export individuales.
  - Resto (Presentar, Editar, Duplicar, Guardar plantilla, Marcar producción,
    Reabrir, Eliminar) sin cambios.

**Verificación:**
- `pnpm test`: 710 tests verdes (217 + 51 + 25 + 321 + 9 + 87). 8 tests
  nuevos para DropdownMenu (a11y, click, escape, outside, disabled,
  aria-expanded). 1 test nuevo en rbac para `production` nav id.
- `pnpm typecheck`: 6/6 workspaces verde.
- Smoke visual: chrome de Projects pasó de 14 botones a 6-7 visibles,
  menú "Más exports ▾" abre con sección Producción/Comercial correctamente.

**Pendiente (Fase 3, próxima):**
- Mudar modales gigantes (Mueble/Estructura/Componente) a vista detalle
  inline con ruta `/:id/edit`.
- Migrar Components y Structures de tabla-expand/card-expand a card-detalle.



## Hecho en esta pasada (2026-07-19) — UI Review Fase 1

**Iniciativa:** Review completo UX/UI (plan aprobado por usuario en 4 fases).
**Branch:** `wip/ui-fase-0-tokens-botones` (continuación de Fase 0)

Fase 1 — **Estandarizar CSS** (P1-P2). 6 componentes compartidos nuevos en
`common/` que absorben ~30 definiciones duplicadas en feature CSS.

**Decisiones de diseño aprobadas:**
- Radios: split — `--radius-md` (8px) para entity-cards, `--radius-lg` (12px)
  para cards secundarias (stats, queue, showcase).
- Hover: unificado a `border --border-brand + shadow-md + bg --surface-hover`.
  Quitamos `transform: translateY(-1px)` y `--brand-300` que tenía Components/
  Structures (inconsistencia con el resto).
- Padding entity-card: `--density-card-pad` (12px) — densidad de herramienta.
- Títulos de pantalla: todo a `--text-xl` (22px) en `.page-header`.

**Cambios:**
- **`common/workspaceChrome.css`** (nuevo): mute de `catalogs.css`. 18 selectores
  que no eran específicos de catalogs (los consumen Projects y Modules).
- **`common/catalogImage.css`** (nuevo): `catalog-image*` consolidado; antes
  duplicado en `catalogs.css` y `moduleShowcase.css`.
- **`common/surfaceCard.css`** (nuevo): `.surface-card` + variantes (`--lg`,
  `--flat`, `--inset`, `--empty`). Absorbe `*-editor__section`, `*-detail__section`,
  `module-part-card`, `project-item-card`, `*-filter-empty`.
- **`common/dataTable.css`** (nuevo): `.data-table` + `.data-table-wrap` +
  `--uppercase`. Absorbe `catalog-table`, `users-table`, `dashboard-owners-table`
  (estaba fuera de convención con paddings propios y sin edge-fades).
- **`common/pageHeader.css`** (nuevo): `.page-header` + sub-bloques. Absorbe
  `catalog-page__header`, `dashboard__header`, `prod-queue__header`,
  `module-showcase__header`. Títulos unificados a `--text-xl`.
- **`common/entityCard.css`** (nuevo): `.entity-card` + `--inactive`/`--expanded`.
  Absorbe `module-card`, `project-card`, `dashboard-recent-card`, `component-card`,
  `structure-card`. `components.css` y `structures.css` quedaron sólo con los
  sub-bloques propios (ya no definen la card base).
- **Cleanup hardcoded colors**:
  - `projects.css`: `#1a1c1e` → `--surface-sidebar`; `rgba(255,255,255,X)` →
    `color-mix(in srgb, --text-inverse X%, transparent)` (patrón oficial).
  - `preview3d/moduleScene3d.css`: `var(--border)` (inexistente) → `--border-default`;
    `#1a1c1e` → `--surface-sidebar`; `#9ca3af` → `--text-muted`.
  - `users.css`: `hsl(0 0% 100%)` → `--text-inverse`.
- **Bug latente arreglado**: `projects.css:405` `var(--warning-700, hsl(32 80% 28%))`
  tenía un fallback que pintaba otro color (hue 32 vs token real hue 38).
  Eliminado el fallback incorrecto.
- **WCAG AA**: `--text-muted` subido de 58% L (~4.0:1, fail) a 52% L (~4.6:1).
  Impacta 45+ selectores que usaban muted para texto pequeño.
- **Font-weight numéricos** eliminados: 5 ocurrencias en `projects.css` migradas
  a `var(--weight-*)`.

**Tests actualizados:**
- `catalogListPrimitives.test.tsx`: ahora verifica contrato en `dataTable.css`
  (no más en `catalogs.css`).
- `designSystem.test.ts`: assertions de density + responsive pasadas a
  `dataTable.css`. `.btn` assertion ya en `buttons.css`.

**Verificación:**
- `pnpm test`: 409 tests verdes (216 domain + 51 storage + 25 excel + 313 ui +
  9 desktop + 87 web).
- `pnpm typecheck`: 6/6 workspaces verde.
- Smoke visual (5 pantallas): modules/components con borders correctos, título
  "Muebles" visible más grande (--text-xl), sin regresiones visibles tras
  quitar `translateY(-1px)`.

**Pendiente (Fase 2, próxima):**
- Actualizar `design.md §6` con las 13 pantallas reales + sección INGENIERÍA
- Unificar patrón de lista: entidad plana = tabla-expand; entidad compleja =
  card + detalle inline
- Agrupar los 7 exports de Projects en menú "Exportar ▾"
- Resolver `home` polimórfico (Dashboard vs ProductionQueue)

**Pendiente (Fase 3, después):**
- Mudar modales gigantes (Mueble/Estructura/Componente) a vista detalle inline
  con ruta `/:id/edit`

**Pendiente (no crítico, backlog):**
- Partir `projects.css` (930 → aún grande) y `catalogs.css` en sub-archivos
  co-localizados (decidido dejarlo para iteración futura — no impacta UX).
- Magic numbers restantes (~30): `0.65rem`, `0.85rem`, `0.45rem` en
  projects/modules/optionGroups. No rompen nada pero理想的mente migrar a tokens.



**Iniciativa:** Review completo UX/UI (plan aprobado por usuario en 4 fases).
**Branch:** `wip/ui-fase-0-tokens-botones`

## Hecho en esta pasada (2026-07-19) — UI Review Fase 0

**Iniciativa:** Review completo UX/UI (plan aprobado por usuario en 4 fases).
**Branch:** `wip/ui-fase-0-tokens-botones`

Fase 0 — **Estabilizar** (P0, UX invisible). Cierra bugs de render y unifica `.btn`.

**Cambios:**
- **`tokens.css`**: definidos tokens auxiliares que el CSS referenciaba sin definir:
  - `--surface-muted` (hsl 220 14% 96%), `--surface-disabled` (hsl 220 12% 94%)
  - Escala completa `--success-100..700` (antes solo 50/500/700)
  - Aliases de compat: `--surface-border` → `--border-default`; `--surface-base` →
    `--surface-sidebar`; `--text-on-dark` → `--text-inverse`; `--color-text*`,
    `--color-border`, `--success`/`--warning`/`--danger`/`--info` (sin escala) →
    sus contrapartes canónicas. Esto resuelve el bug donde Components/Structures
    no renderizaban bordes (var(--surface-border) era undefined).
- **`common/buttons.css`** (nuevo): `.btn` unificado con modifiers
  `--primary/--ghost/--danger/--success/--small/--icon`. Exportado como
  `@muebles/ui/common/buttons.css`. Cargado en `apps/web/src/main.tsx` después
  de reset.css.
- **`catalogs/catalogs.css`**: borrada la definición de `.btn` (vive en
  buttons.css ahora). Limpieza de fallbacks redundantes (`var(--surface-muted, …)`,
  `var(--radius-sm, 4px)`). Arreglado `var(--border)` (sin sufijo) →
  `var(--border-default)` en material-color-swatch y preview-color-picker.
- **`users/users.css`**: borrada la segunda definición de `.btn` (incompatible
  con la de catalogs: modifiers `--sm/--ghost/--success/--danger`, sin density).
  Migración de TSX: `btn--sm` → `btn--small` (4 sitios en UsersScreen.tsx).
- **`components/components.css`** y **`structures/structures.css`**: migrados
  todos los `var(--surface-border)` → `var(--border-default)` / `--border-subtle`,
  `var(--surface-overlay)` (incorrecto para fondo) → `var(--surface-muted)`,
  `var(--success)` (sin escala) → `var(--success-500)` / `--success-700`.
  Hardcoded `2px`/`4px`/`6px`/`10px` → tokens `--space-1/2/3`. Hardcoded
  `font-weight: 600` → `var(--weight-semibold)`. Estructura idéntica en ambos
  archivos (candidatos obvios para Fase 1: extraer `.entity-card` compartido).
- **`projects/projects.css`**: bloque `.project-material-summary` migrado de
  nomenclatura ajena (`--color-text*`, `--color-border` con fallbacks hardcoded)
  a tokens canónicos (`--text-primary`, `--text-secondary`, `--border-default`).
  Modo presentación (`.project-presentation`): `--surface-base`/`--text-on-dark`
  con fallback → `--surface-sidebar`/`--text-inverse`.

**Tests nuevos (regression guards en `designSystem.test.ts`):**
1. `feature CSS only references tokens that exist in tokens.css`: parsea todos
   los .css bajo `packages/ui/src` y verifica que cada `var(--x)` esté definido
   en tokens.css o tenga fallback inline.
2. `.btn base + modifiers live in common/buttons.css only`: garantiza que ningún
   feature CSS vuelva a definir `.btn {` top-level.
3. Package.json exporta `./common/buttons.css`.

**Verificación:**
- `pnpm test`: 313 (ui) + 87 (web) + 9 (desktop) = 409 tests verdes.
- `pnpm typecheck`: 6/6 workspaces verde.
- Smoke visual (playwright, 4 pantallas): Components ahora muestra bordes de
  card correctos; Materials/Structures/Users sin regresión visual.

**Pendiente (Fase 1, próxima):**
- Extraer `.surface-card` / `.entity-card` / `.data-table` / `.page-header`
- Eliminar magic numbers (`0.65rem`, `0.85rem`, etc.)
- Ajustar `--text-muted` para WCAG AA
- Partir `projects.css` (930 líneas) y `catalogs.css` (923 líneas)

## Hecho en esta pasada (2026-07-18) — F056 Plantillas de proyecto (#110)

**Feature:** `F056 — project_templates` (issue #110, [BAJO] → feature grande)
**Branch:** `feat/project-templates-110`

Plantillas de proyecto reutilizables. Colección separada `Workspace.projectTemplates`
+ tipo `ProjectTemplate` (entidad distinta de Project: sin customer/status/
snapshot/owner). Flujo: "Guardar como plantilla" desde un proyecto → "Crear desde
plantilla" clona a proyecto nuevo editable → borrar plantilla. Clone completo
incluyendo kitchenLayout (con remap de `placements.itemId`).

**Cambios por capa:**
- **Dominio TS:** tipo `ProjectTemplate` + `Workspace.projectTemplates` (opcional,
  no requiere migración). Helpers `projectToTemplate` (extrae receta, sin pin) y
  `createProjectFromTemplate` (reminta ids, remapea kitchenLayout placements vía
  idMap posicional, status 'draft'). 8 tests.
- **Storage TS:** mappers `projectTemplateToApi/FromApi` (reusando kitchenLayout,
  measureDefaults, items mappers). 4 métodos en `WorkspaceRepository` + 3
  adapters (jsonFileStorage, apiWorkspaceRepository, localStorageWorkspaceRepository).
  3 tests.
- **Seed:** plantilla demo "Cocina estándar 3 m" (2 gabinetes + 1 cajonera + 2
  alacenas; measureDefaults inferiores/superiores). Test seed incluye plantilla +
  crear proyecto desde ella produce items válidos.
- **UI:** props (projectTemplates + 3 callbacks). Toolbar "Desde plantilla" +
  "Plantillas" (gestión). Chrome "Guardar como plantilla". Empty state con 2da
  acción. 3 modales: picker (lista + form nombre/cliente), save (input nombre),
  management (lista + borrar). CSS nuevo (.template-picker-list/.item,
  .template-management-row). 5 tests.
- **Backend Go (paridad completa):** `ProjectTemplate` struct + tabla
  `project_templates` (JSONB para blobs anidados + items) en migración 000029
  aditiva. Storage CRUD + handlers HTTP + routes `/api/project-templates`.
  RBAC: lectura = `RoleCanAccessProjects`, mutación = `RoleCanMutateModules`.
  Seed "Cocina estándar 3 m". 4 tests HTTP (list, createForbiddenForVendedor,
  createEngineerOK, delete).

**Verificación:** typecheck 6/6 verde · TS tests 699 (domain 216 · storage 51 ·
excel 25 · ui 311 · desktop 9 · web 87) · Go tests ok · `./init.sh` verde.

**Decisiones clave (aprobadas por usuario):**
- Modelo A: colección separada `Workspace.projectTemplates` + tipo
  `ProjectTemplate` (entidad distinta, sin customer/status/snapshot/owner).
  No contamina filtros/dashboard/queries.
- Clone completo including kitchenLayout (con remap de placements.itemId).
- ABM mínimo: guardar desde proyecto + crear desde plantilla + borrar.
- Go incluido con paridad completa.

**Notas técnicas / fuera de alcance:**
- Items de plantilla NO llevan `structureRevisionPin` (la cotización nueva
  cotiza contra la revisión viva; el pin es de cierre).
- Go almacena items como JSONB en `project_templates` (sin tabla separada de
  template_items) para simplicidad y consistencia con los otros blobs.
- No hay editor rico de plantillas (no se editan items in-place); el flujo es
  guardar desde un proyecto real. ABM rico queda como follow-up.
- No se siembran módulos superiores/altos en Go seed (solo MOD-GAB-01/MOD-CAJ-01);
  la plantilla seed Go usa esos 2.

## Hecho en esta pasada (2026-07-18) — F055 Parámetros de medida a nivel proyecto (#109)

**Feature:** `F055 — project_measure_defaults` (issue #109, [BAJO] → feature grande)

Defaults de medida (fondo/alto) a nivel proyecto, **keyed por tipo de mueble**
(inferior/superior/alto). Al agregar un mueble, se pre-selecciona el preset más
cercano a los defaults del tipo de ese módulo. Override por línea vía
`measurePresetId` (ya existente). Snapshot congela vía `priceSnapshot` (existe).

**Aprendizaje clave del dominio:** los 3 tipos de mueble del taller (gabinetes
~560 fondo, alacenas ~320 fondo, despensas ~2100 alto) NO estaban modelados. El
sistema de `categoryId` es un árbol libre editable por el usuario, vacío en el
seed, con UUIDs workspace-local — no servía como discriminador estable. Por eso
se introdujo `FurnitureType` enum first-class, desacoplado del árbol de
categorías. Esto desbloquea features futuras (placement 3D por tipo,
componentes default, etc.).

**Cambios por capa:**
- **Dominio TS:** `FurnitureType` enum + `Module.furnitureType` + `Project.measureDefaults`
  keyed por tipo + helper `pickPresetByMeasureDefaults` (match más cercano) + 9 tests.
- **Seed:** 3 inferiores existentes taggeados + 2 nuevos (Alacena superior
  600×720×320, Despensa alto 600×2100×600) con BOM paramétrico válido + smoke tests.
- **UI módulo:** editor de `furnitureType` en GeneralPanel + round-trip draft + test.
- **UI proyecto:** sección live "Parámetros de medida" (fila por tipo en uso,
  inputs Fondo/Alto mm con layout propio desacoplado de catalog-form__field) +
  matching en `selectModuleForAdd` + badge de tipo en cada línea de cotización
  + 8 tests.
- **Storage TS:** round-trip `furniture_type` + `measure_defaults` (snake/camel
  dual-read) + 3 tests.
- **Backend Go (paridad completa):** types + helper port + migración aditiva
  000028 + storage (8 sitios SQL) + seed + 10 subtests de regresión.

**Verificación:** typecheck 6/6 packages · TS tests 679+ verde · Go tests ok ·
`check-tokens.mjs` cero deuda · `./init.sh` verde.

**Decisiones clave (aprobadas por usuario):**
- Modelo C: default de UI (no toca `resolveBom` ni engine; preset por ítem sigue
  siendo la entrada). Override por línea ya existía. Snapshot ya existía.
- Enum `FurnitureType` first-class (no categoryId) — desacoplado del árbol editable.
- Defaults keyed por tipo: `{ [furnitureType]: { depth?, height? } }`.
- UX: sección live (como F029) + match más cercano con fallback al primer preset.
- Go incluido con paridad completa. Seed TS con 3 tipos; Go solo taggea los 3
  inferiores existentes (los 2 módulos nuevos son TS-only demo).

**Fuera de alcance:**
- No agrega módulos superior/alto al seed Go (TS demo basta).
- No toca `resolveBom`/engine de resolución (el preset resuelto por ítem sigue
  siendo la entrada al engine).
- No agrega `width` a `measureDefaults` (width varía por preset comercial — es
  decisión del vendedor por línea).

## Hecho en esta pasada (2026-07-17)

- Judgment Day Round 1 → ESCALATED; issues #125–#142
- Plan App Excellence documentado
- **Fixes JD Round 1 (confirmed):**
  - #127 App.tsx → ProjectsScreen structures/components
  - #125 apiMappers spatial round-trip component + instance
  - #126 Go formulas PH/PW/PD/T/i
  - #128 per-axis pose fallback + lateral_derecho + laterals rotX/Y
  - #129 multi-módulo WebGL msg, ghosts, DEFAULT_MODULE_FOOTPRINT_MM
  - #130 preview color validate/normalize; no pisar color al upload
- Tests: domain, storage, ui preview/materials, go engine — verdes

## Docs

| Doc | Rol |
|-----|-----|
| `docs/app-excellence.md` | Plan + issues |
| `docs/judgment-day-wip-3d-2026-07-17.md` | JD findings |
| `docs/prd.md` §6.7 | Política corte / CNC / layout |

## Siguiente

1. Commit/PR de fixes JD + docs (cuando pedís)
2. Residual opcional: migration `structure_components.overrides` + rotate NULL en components
3. Ola B: #133 layout cocina
