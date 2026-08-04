# Judgment Day — App Excellence 2026-08-04

> **Fecha:** 4 de agosto de 2026
> **Contexto:** Auditoría end-to-end post-Fase 5. El roadmap `perfect-app-roadmap.md`
> (Fases 0–5) y la Ola C de `app-excellence.md` están completados. Esta ronda
> busca qué falta para que la app sea "perfecta" para crear → diseñar →
> presupuestar → despiezar.
> **Método:** auditoría read-only del flujo real + revisión de los 2 JD previos
> (`2026-07-17` UI/3D, `2026-07-29` review integral).

---

## Resumen ejecutivo

**El catálogo (ingeniería) y el presupuesto son production-grade.** El problema
no es falta de features — es que **3 eslabones del flujo extremo a extremo están
desconectados**: el editor board-first no persiste, la vista de tablero de
producción es código muerto, y el flujo comercial está escondido tras un
`<select>`. Hay además 7 gaps de menor impacto (integridad referencial,
errores silenciados, tests faltantes).

Los 2 JD previos (julio) ya cerraron los bugs críticos de 3D (#186–#190),
accesibilidad (#188), responsive (#191) y errores de pricing (#195–#196).

---

## Los 10 gaps (ordenados por impacto en el flujo)

### 🔴 Gap #1 — BoardEditor no persiste (el más grave)

**Dónde:** `apps/web/src/components/BoardEditor.tsx` + `apps/web/src/stores/editorStore.ts`

**Qué pasa:** El editor board-first (Fase 1, "el corazón" del roadmap) permite
drag/duplicate/remove/resize piezas. Pero `loadModule` (línea 75) solo carga en
memoria y `clearEditor` (línea 81) descarta al desmontar. El JSDoc del store
(línea 6) dice explícitamente: *"el caller deriva los cambios de pose de vuelta
a ModuleComponentInstance.overrides"* — **ningún caller lo hace**.

**Impacto:** El usuario diseña un mueble manipulando piezas, guarda, y pierde
todo. Esto **rompe la promesa central** del roadmap board-first y genera
desconfianza (parece funcionar pero no guarda).

**Fix:** Al guardar el módulo, leer el estado final del editorStore y mapear
las poses editadas → `ModuleComponentInstance.placementOverride` del draft.

**Esfuerzo:** Alto (diseño de mapping + tests).

---

### 🔴 Gap #2 — Vista de tablero de producción es código muerto

**Dónde:** `packages/ui/src/production/ProductionQueue.tsx:54,271,290` + `apps/web/src/App.tsx:1544`

**Qué pasa:** `ProductionQueue` ya consume el prop `cutRowsFor` y renderiza
`ProductionBoardView` (SVG de piezas sobre 2440×1220). Pero App.tsx **nunca
pasa el prop**, así que el toggle "Ver tablero" jamás aparece.

**Impacto:** Producción incompleta — el operario ve la cola pero no el plan de
corte visual, a pesar de que el componente ya existe.

**Fix:** En App.tsx, cablear `cutRowsFor={(projectId) => generateCutRows(...)}`
usando `generateCutRows` de `packages/domain/src/engine/cut.ts` + el breakdown
del proyecto.

**Esfuerzo:** Bajo (cablear + 1-2 tests).

---

### 🟡 Gap #3 — Flujo comercial oculto tras un `<select>`

**Dónde:** `packages/ui/src/projects/components/ProjectMetaModal.tsx:252-273`

**Qué pasa:** Las transiciones `draft → quoted → accepted → produced` solo se
hacen via un `<select>` genérico dentro del modal "Editar meta". No hay botones
primarios "Enviar al cliente" / "Aceptar cotización" en el chrome del detalle.
Solo "Marcar en producción" y "Reabrir" están surfaced.

**Impacto:** El flujo comercial (el más usado por ventas) está escondido detrás
de un formulario genérico. No hay narrativa de "avance del proyecto".

**Fix:** Añadir botones contextuales al `ProjectDetailView` chrome según el
estado actual (draft → "Enviar al cliente"; quoted → "Marcar aceptada").

**Esfuerzo:** Medio (UI + handler + tests).

---

### 🟡 Gap #4 — Huérfanos referenciados sin aviso

**Dónde:** `packages/ui/src/structures/components/StructureEditorComponentsPanel.tsx:100-102` (y screens de módulos)

**Qué pasa:** Desactivar/eliminar un componente/material/canto/herraje deja
referencias rotas (`componentId`/`materialId` inexistentes) en estructuras y
módulos. La UI renderiza el UUID crudo sin warning, badge rojo, ni indicador.
No existe ningún validador de integridad referencial en `packages/domain`.

**Impacto:** El usuario descubre el problema recién al exportar (como
`ExportIssue`) — tarde y confuso.

**Fix:** (a) validador de dominio `validateCatalogRefs` que detecte dangling;
(b) UI muestre badge "componente eliminado" en lugar del UUID.

**Esfuerzo:** Medio.

---

### 🟡 Gap #5 — `countModulesUsingGroup` roto para board/edge

**Dónde:** `packages/ui/src/optionGroups/OptionGroupsScreen.tsx:87-98`

**Qué pasa:** El warning al borrar un grupo solo cuenta módulos cuyos
`hardwareLines` referencian el code del grupo — **no puede ver** los option
roles declarados por componentes compuestos (lo admite el comentario líneas
91-94). Borrar un grupo BOARD usado por 50 módulos reporta "Afecta a 0
muebles" — **activamente engañoso**.

**Impacto:** Decisiones de borrado basadas en datos falsos.

**Fix:** Extender el contador para resolver option roles via BOM de cada
módulo, o al menos marcar "conteo parcial" en la UI.

**Esfuerzo:** Bajo-Medio.

---

### 🟢 Gap #6 — `EdgesCatalog` sin test de componente

**Dónde:** `packages/ui/src/catalogs/EdgesCatalog.tsx` (no hay `EdgesCatalog.test.tsx`)

**Qué pasa:** Es la única screen de catálogo sin test. Los paths de validación
(código único, costo no negativo, soft delete) no están cubiertos a nivel UI.

**Fix:** Añadir `EdgesCatalog.test.tsx` siguiendo el patrón de
`MaterialsCatalog.test.tsx` / `HardwareCatalog.test.tsx`.

**Esfuerzo:** Bajo.

---

### 🟢 Gap #7 — Breakdown bloqueado sin explicar por qué

**Dónde:** `apps/web/src/App.tsx:288-294` (y 698-701 `materialSummary`)

**Qué pasa:** Cuando `calcProjectBreakdown` lanza, el catch devuelve
`previewBlocked: true` con `missingGroups: []` vacío. El usuario ve "preview
bloqueado" sin pistas. Mismo patrón en `materialSummary` (devuelve `null`, sin
toast).

**Impacto:** Cotización atascada sin diagnóstico posible.

**Fix:** Preservar el mensaje de error / `missingGroups` real en el catch y
mostrarlo en la UI.

**Esfuerzo:** Bajo.

---

### 🟢 Gap #8 — Kitchen Plan congelado tras `draft`

**Dónde:** `packages/ui/src/projects/components/ProjectDetailView.tsx:340`

**Qué pasa:** `KitchenPlanPanel` solo es editable si `project.status === 'draft'`.
Una vez enviado (quoted), no se puede ajustar ni siquiera para corregir un
layout encontrado en negociación. No hay tooltip que explique por qué está
deshabilitado.

**Impacto:** Decisión de producto aceptable, pero **indocumentada en UI** — el
usuario cree que es un bug.

**Fix:** Añadir tooltip "El plano se congresa al enviar la cotización" o
permitir edición en quoted con aviso.

**Esfuerzo:** Bajo.

---

### 🟢 Gap #9 — Errores de persistencia inconsistentes

**Dónde:** `apps/web/src/stores/projectStore.ts`

**Qué pasa:** `createProject` y `duplicateProjectById` muestran toast en fallo
de backend; pero `updateProject` (línea 398) y `deleteProject` (línea 405) solo
`console.error` — el usuario cree que guardó.

**Fix:** Unificar: todas las mutaciones de proyecto tuestean en fallo.

**Esfuerzo:** Bajo.

---

### 🟢 Gap #10 — Sin "cargar demo" en empty states de catálogo

**Dónde:** Empty states de Materials/Edges/Hardware/OptionGroups/Components/Structures

**Qué pasa:** Cada empty state solo ofrece "Agregar X". No hay un CTA "cargar
catálogo demo" para bootstrapear rápido la cadena de ingeniería en un workspace
nuevo. `createSeedWorkspace()` existe (App.tsx:1472) pero solo se usa como
fallback de error.

**Fix:** Añadir botón "Cargar datos de ejemplo" en los empty states que llame a
un seed controlado.

**Esfuerzo:** Bajo-Medio.

---

## Plan de ataque — 4 milestones

Cada milestone entrega valor autónomo y deja la app más cerca de "perfecta".

### Milestone 1 — Cerrar la cadena de producción (gaps #2 + #7)
*Quick wins que reconectan lo que ya existe.*

- **#2** cablear `cutRowsFor` en App.tsx (la vista de tablero ya está construida)
- **#7** preservar errores de breakdown para que el usuario entienda por qué se bloquea
- **Criterio:** el operario ve el plan de corte visual en la cola; el vendedor
  entiende por qué una cotización no presupuesta.

### Milestone 2 — Integridad y confianza (gaps #4 + #5 + #9)
*Que no haya sorpresas silenciosas.*

- **#4** validador de huérfanos + badge "eliminado" en UI
- **#5** arreglar `countModulesUsingGroup` (o marcarlo "parcial")
- **#9** unificar toasts de persistencia
- **Criterio:** borrar/desactivar algo del catálogo avisa del impacto real; no
  hay fallos silenciosos de guardado.

### Milestone 3 — Flujo comercial explícito (gaps #3 + #8)
*Que el avance del proyecto sea obvio.*

- **#3** botones contextuales de estado en el chrome del detalle
- **#8** tooltip/explicación cuando el plano se congela
- **Criterio:** draft→enviar→aceptar→producir se hace con botones claros, sin
  tocar el modal de meta.

### Milestone 4 — BoardEditor persistente (gap #1) + pulido (#6 + #10)
*El "corazón" del roadmap, dejado para último porque es el de mayor esfuerzo.*

- **#1** write-back de poses del editor → `placementOverride` del módulo
- **#6** test de `EdgesCatalog`
- **#10** CTA "cargar demo" en empty states
- **Criterio:** diseñar un mueble manipulando piezas y que **se guarde**.

---

## Verificación de cada milestone

- `pnpm test` verde (tests nuevos incluidos)
- `pnpm typecheck` verde si tocó tipos
- PR por milestone, squash merge, branch borrada tras merge
- Actualizar este doc con el estado de cada gap tras cerrar el milestone

---

## Notas

- Los JD previos (2026-07-17, 2026-07-29) cerraron los bugs 3D/accesibilidad/pricing.
- `docs/app-excellence.md` está desactualizado respecto al código (marca como
  WIP/P1 cosas ya hechas en Fase 1-5). No corregirlo ahora — priorizar código.
- `apps/web/src/App.tsx` (1857 L) sigue monolítico; los stores F062-F064
  aligeraron pero queda trabajo. Fuera de scope de este plan.
