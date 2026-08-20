# Judgment Day — SHELL (App.tsx + wiring)

**Fecha:** 2026-08-19
**Scope:** `apps/web/src/App.tsx` (4101 L) + wiring: `routes.ts`, `AppShell.tsx`, `workspaceStore`, `uiStore`, `projectStore`, `SessionGate`, boot flow, auth/ sesión, deep-links, RBAC de nav, persistencia del workspace, flujo de exports.
**Método:** 2 exploraciones exhaustivas (App.tsx profundo + wiring del shell) + verificación manual de los 4 hallazgos más graves contra el código.
**Features registradas al cierre:** F118 (bugfixes críticos del shell), F119 (refactor/slimming del shell).

---

## 0. Resumen ejecutivo / Veredicto

El shell **funciona en el happy path** (boot, login, navegación, exports), y la deuda de F057–F064 está parcialmente contenida: sesión, toasts, catálogo y proyectos SÍ viven en stores. Pero:

1. **Hay un bug de pérdida de datos real en `saveWorkshopSettings`** (S1): guardar un ajuste del taller después de editar catálogo/proyectos revierte la UI **y pisa el server** con el snapshot viejo. Es el peor bug encontrado en los dos judgment days hasta ahora.
2. **Las carreras de sesión no están guardadas** (S2): logout con saves/loads en vuelo, guest→login que descarta trabajo sin avisar.
3. **Dos bugs de navegación que rompen flujos visibles**: cliente→cotización aterriza en Inicio (path hardcodeado inexistente) e ítem "Usuarios" muerto para guest.
4. **La deuda estructural se regeneró**: AppContent volvió a ~2600 L — el bloque de compras/stock (~450 L) nunca migró a store y los 13 handlers de export (~700 L copy-paste) tampoco. App.tsx total: 4101 L (F064 prometía <600).

**Recomendación:** F118 antes que F119 (misma regla que catálogos): primero el clobber S1 y las carreras, después el slimming.

---

## 1. Mapa del shell

| Sección | Líneas (App.tsx) | Qué es |
|---|---|---|
| Imports + helpers | 1–269 | ~130 imports; `optionalNotes` muerto |
| Funciones puras exportadas | 271–431 | `computeModuleCostPreview`, `resolveDisplayBreakdown` |
| `App()` + `SessionGate()` | 434–499 | Limpios (F057 intacto) |
| **`AppContent()`** | **501–3108** | **El monolito real (~2600 L)** |
| Render: 26 screens | 3110–4101 | Switch manual por `navId`; ProjectsScreen ~150 props |

Dentro de AppContent: wiring de stores (509–698), compras/stock/proveedores/OC local (745–1067, **~450 L nunca migrados**), router plumbing (1132–1245), derivaciones de dominio (1320–1903), aliases a stores (1905–2238), **13 handlers de export copy-paste (2273–2974, ~700 L)**, navegación (2976–3058).

**Veredicto F057–F064**: sesión ✅, toasts/exportBusy/createKeys ✅ (estado en uiStore, call sites en App), catálogo ✅ delegado, proyectos ✅ delegado **excepto compras/stock**. El sync effect workspace→stores (583–589 / 688–698) re-crea el acoplamiento que F062 quitó — y es la causa del bug S1.

---

## 2. Bugs CRÍTICOS (verificados personalmente)

### S1 — `saveWorkshopSettings` revierte la UI y **pisa el server** con datos viejos
`workspaceStore.ts:294-309` construye `next` desde el workspace **del momento de carga** (catálogo + proyectos stale desde F062/F063, porque los stores ya no escriben back a workspace). Luego:
- `set({ workspace: next })` → los effects de sync de App (`App.tsx:583-589, 688-698`, deps `[workspace]`) re-inyectan el catálogo/proyectos viejos en catalogStore/projectStore → **todas las ediciones desde la carga desaparecen de la UI**.
- `repository.save(next)` → `APIWorkspaceRepository.save()` (`apiWorkspaceRepository.ts:254-265`) hace `saveCatalog` + `saveProject` de **todo el snapshot viejo** → **las ediciones de catálogo/proyectos desde la carga se revierten también en el servidor**. En guest: ídem contra localStorage.

Camino real: editar un material → guardar Ajustes del taller → el material editado vuelve a su valor anterior (UI y server). Silencioso total.

### S2 — Carreras de sesión sin guardas
- `loadWorkspace` (`workspaceStore.ts:267-288`) valida `session === null` **solo al entrar**; un `repository.load()` que resuelve después del logout hace `set({ workspace: ws })` con sesión caída.
- Saves de proyectos en vuelo al hacer logout → 401 → toasts de error **en la pantalla de login** (`projectStore.ts:516-522` fire-and-forget, sin abort ni markSessionExpired).
- `logout()` (`workspaceStore.ts:245-259`) no limpia `catalogStore`/`projectStore` (singletons de módulo): el catálogo/proyectos del usuario anterior quedan en memoria durante la pantalla de login (privacidad en máquinas compartidas).

### S3 — Guest → login descarta el trabajo guest sin flush ni aviso
El switch de repositorio (`workspaceStore.ts:68-71`) cambia a API al hacer login; los datos guest quedan varados en `muebles_guest_workspace` sin migración, sin prompt, sin aviso. El usuario que cotizó como invitado y se loguea "pierde" (visualmente) todo.

### S4 — Cliente → cotización navega a Inicio
`App.tsx:3790`: `navigate(\`/cotizaciones/${projectId}\`)` — pero `NAV_PATHS.quotes = '/quotes'` (`routes.ts:11`). `navFromPath` no matchea → el guard (`App.tsx:1226-1230`) hace replace a Inicio. El flujo "abrir cotización desde la ficha del cliente" está roto. Fix: `projectPath(projectId)`.

### S5 — "Usuarios" visible para guest pero inalcanzable
`rbac.ts:514` incluye `'users'` en el set guest; la pantalla exige `showAdminUsers && authToken` (`App.tsx:3806`), ambos falsos para guest → ítem muerto en el sidebar (click no hace nada).

### S6 — Recuperación de error de carga con datos demo inconsistente
El botón "Usar datos demo" (`App.tsx:3088`) hace `setWorkspace(createSeedWorkspace())` sin persistirlo ni resetear flags del store; y `handleLoadCocinaLopezDemo` navega al id hardcodeado `proj-cocina-lopez-demo` que solo existe en seed guest → en modo auth lleva a "Proyecto no encontrado".

---

## 3. Bugs ALTOS

| # | Hallazgo | Dónde |
|---|---|---|
| A1 | **Exports**: `exportBusy` es UN boolean global para 13 exports → dos exports concurrentes se desbloquean entre sí; `exportErrors` compartido nunca se limpia al cambiar pantalla (lista de errores stale); varios handlers sin try/catch alrededor del builder (excepción → unhandled rejection sin toast; solo `cutPlanPdf` catchea bien); elevations muestra solo `issues[0]?.message` | `uiStore.ts:90-91`, `App.tsx:2273-2974` |
| A2 | Saves de proyectos optimistas sin rollback; 401 durante save no llama `markSessionExpired` (solo el regex de workspaceStore) | `projectStore.ts:503-525` |
| A3 | Fallos de lectura de compras/stock se tratan como "vacío" (la pantalla muestra stock vacío como verdad); `reloadPicking/refreshStock/refreshPurchasing` dejan estado stale en silencio | `App.tsx:843-852, 757-801` |
| A4 | `handleTogglePick`: el revert del ledger es best-effort — si el movimiento compensatorio falla, el stock queda sobre-debitado en silencio; `listStockMovements({limit: 200})` puede no ver despachos viejos → stock nunca revertido | `App.tsx:1497-1609` |
| A5 | `useBackendBreakdownEffect` depende de la identidad de `project` → refetch después de CADA save (debounced) — chatty; mejor dep: `project.updatedAt` | `projectStore.ts:1748` |
| A6 | Deep-links: `finishes` registrado en ENTITY_SECTIONS pero `AmbientMaterialsCatalog` no consume `openEntityId` (confirmado, ya señalado en JD Catálogos); `addOns` al revés: `AgregadosScreen` SOPORTA selección routable pero no está en ENTITY_SECTIONS ni cableado; `/section/:id/edit` para secciones no-modules/structures/components es silent no-op | `routes.ts:117-128`, `App.tsx:3746-3765, 3924-3938, 1218-1223` |
| A7 | Path desconocido → replace silencioso a Inicio sin 404 ni toast (se pierde la entrada de historial) | `App.tsx:1226-1230` |
| A8 | `onExportCommercialQuote` solo gateado por `filterProjectsToPlant`, sin check de rol comercial en cliente (server re-valida) | `App.tsx:4034` |

## 4. MEDIOS / deuda

- `getRepository()` construye un `APIWorkspaceRepository` nuevo por llamada (stateless hoy, frágil mañana); sin AbortController en ningún lado.
- `depsKey` compara deps por `String(fn)` (identidad por texto fuente) — funciona pero es un pie para pisar (`projectStore.ts:1602-1612`).
- Muertos: memo `repository` (`App.tsx:1095-1098`), `optionalNotes` (`:266-269`), props duplicados de export en EngineeringWorkspace (`onExportCsv/onExportCutListCsv`, `onExportPdf/onExportPieceLabels`), rama muerta en `onEntityEditRequest` (`:3003-3023`), helpers `structureEditPath/componentEditPath` ignorados.
- `ProductionManagerDashboard` es la única pantalla sin `ScreenBoundary`.
- `confirmFabricBatch` usa `window.confirm` — inconsistente con el patrón modal de design.md.
- `useCatalogStore()` / `useProjectStore()` sin selector → AppContent re-renderiza con cualquier cambio de store (perf).
- Token en localStorage sin expiración client-side; registro no auto-vuelve a login (lo maneja RegisterScreen sola).
- Command palette: ítems de módulos son "primeros 12 en orden de inserción", no recientes; sin clientes/materiales.
- `workspaceLoading` seteado y nunca leído; `workspaceRef` stale (flag #15 en el propio archivo).

---

## 5. Plan de acción

### F118 — `shell_critical_bugfixes` (primero)
1. **S1**: `saveWorkshopSettings` deja de llamar `repository.save(workspace)` — persistir SOLO settings (el repo ya tiene `saveWorkshopSettings`); y los effects de sync pasan a dispararse por sesión/loadSeq (o `setWorkspace` explícito), no por identidad de workspace.
2. **S2**: guardas de sesión — loadWorkspace re-valida `session` tras el await; abortar/ignorar saves post-logout; `logout()` limpia catalogStore/projectStore (setCatalog(null)/setProjects([])).
3. **S3**: decisión de producto — al login con datos guest existentes, ofrecer migrar/ignorar (modal), o al menos toast "tu trabajo invitado queda guardado localmente". Default propuesto: modal con 2 opciones.
4. **S4**: `navigate(projectPath(projectId))` + test.
5. **S5**: quitar `'users'` del set guest en rbac.ts (+ test de nav guest).
6. **S6**: "Usar datos demo" persiste el seed y resetea flags; demo de cocina navega por lookup de id real, no hardcode.
7. A1: busy por export (string key o contador) + limpiar `exportErrors` al cambiar de pantalla + try/catch uniforme en los builders.

### F119 — `shell_refactor_slim` (después)
1. `runExport(builder, opts)` — un helper reemplaza los 13 handlers (~700 → ~80 L).
2. `purchasingStore` — migrar compras/stock/proveedores/OC + `handleTogglePick` (~450 L fuera del shell).
3. Derivaciones (cutRows, metrics, estimates) a módulo de selectors puro.
4. Render: extraer wrappers por área (EngineeringWorkspace IIFE → componente, ProjectsScreen props agrupadas), `App.tsx` < 800 L (meta realista hacia <600).
5. Limpieza de muertos (§4) + ScreenBoundary en ProductionManagerDashboard + `window.confirm` → modal.
6. A6: wire deep-link de finishes y addOns (o quitarlos de ENTITY_SECTIONS si no se quieren).

---

## 6. Registro

- **F118** `shell_critical_bugfixes` — pending, prioridad alta (S1 es pérdida de datos).
- **F119** `shell_refactor_slim` — pending, después de F118.
- Próximos JD sugeridos: Cotizaciones/Proyectos (detalle), Producción/Fábrica, Proyectar 3D.
