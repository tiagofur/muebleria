# Sesión actual — F062 catalogStore

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch activa:** `wip/perfect-app-fase-0-catalog` (basada en `wip/perfect-app-fase-0`)
- **META issue:** #156 Perfect App roadmap
- **Feature:** F062 — phase0_catalog_store (sub-slice 2 de 4 de Fase 0)
- **Iniciada:** 2026-07-21

## Plan F062 (slice aprobado)

1. ✅ Branch + marcar F062 in_progress.
2. Crear `catalogStore.ts` con 28 actions.
3. Modificar `workspaceStore.ts`: dropear `catalog` del state, poblar catalogStore en `loadWorkspace()`.
4. Migrar `App.tsx`: eliminar `patchCatalog` + 28 handlers.
5. Tests: `catalogStore.test.ts` behavior + actualizar `App.test.ts`.
6. Verificar: `pnpm test`, `pnpm typecheck`, `./init.sh`, `pnpm visual`.
7. Reviewer + push.

## Decisión clave

**catalogStore POSEE su catálogo** (state `{ catalog: Catalog | null }`), no coordina con workspaceStore. `Workspace` pasa a ser view model ensamblado al cargar. Más limpio arquitectónicamente.

## Cross-store coupling

- `createProject`/`updateProject`/`createFromTemplate` llaman `catalogStore.upsertCustomers(customers)` (acción pública).
- `updateMaterial` (#138) lee `workspaceStore.getState().workspace?.projects` para contar drafts.
- `deleteModule` acepta callback opcional `onModuleDeleted(id)` para que App resetee `editingModuleId`.
- catalogStore lee `authToken` via `useWorkspaceStore.getState().getAuthToken()` (unidireccional).

## Objetivos

- App.tsx 2810 → ~1900 L.
- 28 handlers migrados, `patchCatalog` eliminado.
- `workspaceRef` ya no se usa para catálogo (solo para projects hasta F063).

## Fuera de alcance F062

- projectStore (F063): handlers de proyecto quedan en App.tsx, leen catalogStore via getState().
- uiStore + ToastProvider (F064): toast se inyecta como dep callable al store.
