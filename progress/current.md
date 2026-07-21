# Sesión actual — F057 workspaceStore

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch:** `wip/perfect-app-fase-0` (basada en `main` post #155 docs/perfect-app-roadmap)
- **Feature:** F057 — phase0_workspace_store (sub-slice 1 de 4 de la Fase 0 Perfect App)
- **Iniciada:** 2026-07-21
- **META issue:** #156 Perfect App roadmap

## Contexto estratégico

Rumbo confirmado con el usuario (`docs/perfect-app-roadmap.md`):
board-first + 3D por rol + herramienta de oficio. Fase 0 = deuda técnica
antes de features nuevas. F057 es sub-slice 1 de 4 (workspaceStore,
catalogStore, projectStore, uiStore).

## Plan F057 (slice aprobado)

1. ✅ Ajustar `feature_list.json` — F057 rescrita (workspaceStore), F062/F063/F064 creadas.
2. Marcar F057 `in_progress` + este `current.md`.
3. Agregar `zustand ^5.0.14` a `apps/web/package.json` (ya está en lockfile transitivo).
4. Crear `apps/web/src/stores/` + `workspaceStore.ts` + `index.ts`.
5. Escribir `workspaceStore.test.ts` (behavior tests).
6. Migrar estado en App.tsx (SessionGate + workspace load + assignableOwners + workshopSettings).
7. Actualizar `App.test.ts` + `designSystemShell.test.ts` (text-matching → behavior).
8. Verificar: `pnpm test`, `pnpm typecheck`, `./init.sh`, smoke Playwright.
9. Llamar reviewer.

## Invariante F057

- Solo migra **sesión + workspace load + assignableOwners + workshopSettings + repository + authToken/User**.
- ToastProvider **NO se toca** (se migra en F064).
- catálogo, proyectos, handlers de mutación de catálogo/proyecto **NO se tocan** (F062/F063).
- `workspaceRef`, `patchCatalog`, `patchProjects` siguen existiendo hasta F062/F063.
- App.tsx objetivo: < 2500 líneas (de 2880). El objetivo < 600 llega al cerrar F062+F063+F064.

## Estado que migra a workspaceStore

| Origen (App.tsx/SessionGate) | Destination (workspaceStore) |
|---|---|
| `session` (SessionMode \| null) + sessionStorage | store + persist (sessionStorage) |
| `authGate` ('login' \| 'register') | store |
| `loginLoading/Error`, `registerLoading/Error` | store |
| `workspace` (solo settings + schemaVersion + loaded flag) | store (catálogo y proyectos en F062/F063) |
| `workspaceLoadError` | store |
| `assignableOwners` | store |
| `repository` (API vs LocalStorage) | store getter derivado de `session` |
| `authToken`, `authUser` (leídos de localStorage) | store selectors |

## Acciones del store

- `enterAsGuest()`, `login(email, password)`, `register(name, email, password)`, `logout()`
- `loadWorkspace()` (hidrata solo settings en este slice)
- `loadAssignableOwners()`
- `saveWorkshopSettings(settings)`
- `setAuthGate(mode)`
- `resolveMediaUrl(url)`, `uploadCatalogImage(file)`

## Tests a actualizar

- `App.test.ts`: `#13 recover de load failure` (text-matching → behavior store)
- `designSystemShell.test.ts`: `Slice E LoginGate`, `Slice F logout` (text-matching → behavior store)
- `F019 ToastProvider`: **NO se toca** en F057 (se reescribe en F064).

## Decisiones del sub-slicing (aprobadas)

- F057 original (los 4 stores) era muy grande para un PR. Se dividió en:
  - **F057** = workspaceStore
  - **F062** = catalogStore
  - **F063** = projectStore
  - **F064** = uiStore (incluye migrar ToastProvider)
- Tests text-matching se reescriben a behavior tests (mejor calidad, durable).
