# Sesión actual — F063 projectStore

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch activa:** `wip/perfect-app-fase-0-project` (basada en `main` post-F062)
- **META issue:** #156 Perfect App roadmap
- **Feature:** F063 — phase0_project_store (sub-slice 3 de 4 de Fase 0)
- **Iniciada:** 2026-07-21

## Plan F063 (slice aprobado)

1. ✅ Branch + marcar F063 in_progress.
2. Crear `projectStore.ts` con 19 actions + `useBackendBreakdownEffect` hook.
3. Modificar `workspaceStore.ts`: dropear `projects`/`projectTemplates`, poblar projectStore en `loadWorkspace`.
4. Migrar App.tsx: eliminar `patchProjects` + 19 handlers + useEffect del calculate.
5. Tests: `projectStore.test.ts` behavior + actualizar `App.test.ts` (4 tests).
6. Verificar: `pnpm test`, `pnpm typecheck`, `./init.sh`, `pnpm visual`.
7. Reviewer + push.

## Decisiones clave

- **projectStore POSEE** `{ projects, projectTemplates, backendBreakdown, breakdownLoading, breakdownError }`. workspaceStore dropea `projects` y `projectTemplates`.
- **Bug fix F062 aprovechado**: `createProject`/`updateProject`/`createFromTemplate` ahora llaman `catalogStore.getState().upsertCustomers(resolved.customers)` (antes mutaban workspace.catalog que ya no existe).
- **useBackendBreakdownEffect hook en store**: con debounce interno 300ms + fallback + toast.
- **workspaceRef eliminado totalmente** de App.tsx (verificación final con grep).

## Cross-store coupling

- `createProject`/`updateProject`/`createFromTemplate` → `catalogStore.getState().upsertCustomers(customers)` + persist projects.
- `markProjectProduced`/`reopenProject`/`applyScenarioB` reciben `catalog: Catalog` como parámetro (lo lee App.tsx desde catalogStore).
- projectStore lee `authToken` y `session` via `useWorkspaceStore.getState()`.

## Objetivos

- App.tsx 2261 → ~1400 L.
- 19 handlers migrados, `patchProjects` eliminado.
- `workspaceRef` desaparece totalmente.

## Fuera de alcance F063

- uiStore + ToastProvider (F064): toast se inyecta como dep callable.
- Partir ProjectsScreen (F058).
