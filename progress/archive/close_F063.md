# Close — F063 projectStore Zustand

**Feature:** F063 — phase0_project_store (sub-slice 3 de 4 de Fase 0 Perfect App)  
**Branch:** `wip/perfect-app-fase-0-project` (basada en `main` post-F062)  
**Commit:** principal de F063  
**META issue:** #156 Perfect App roadmap  
**Reviewer:** pendiente

## Qué se hizo

Migró el **slice de proyecto completo** (19 handlers + hook de backend breakdown)
desde `App.tsx` a un store Zustand nuevo (`projectStore`).

### Archivos nuevos

- `apps/web/src/stores/projectStore.ts` (851 L): store con 19 actions +
  `useBackendBreakdownEffect(projectId, project, session, toast)` hook.
- `apps/web/src/stores/projectStore.test.ts` (599 L): 27 behavior tests.

### Archivos modificados

- `apps/web/src/App.tsx` (2261 → 1788 L, **-473**):
  - Eliminado `patchProjects` wrapper + 19 handlers.
  - useEffect del calculate reemplazado por `useBackendBreakdownEffect`.
  - 3 useState eliminados (backend breakdown states).
  - `projects`/`projectTemplates` ahora se leen del projectStore.
  - Helpers `resolveCustomerFromDraft`/`draftToProjectMeta` mudados al store.
- `apps/web/src/stores/index.ts`: barrel export.
- `apps/web/src/App.test.ts`: 4 tests text-matching reescritos a behavior.

### Verificación ejecutada

| Check | Resultado |
|---|---|
| `pnpm typecheck` (6/6 workspaces) | ✓ verde |
| `pnpm test` (web 171 + desktop 9 + ui + domain/storage/excel) | ✓ verde |
| `./init.sh` | ✓ verde |
| `pnpm visual` (Playwright, 6 screenshots) | ✓ 6/6 sin re-baseline |

## Decisiones de diseño clave

1. **projectStore POSEE** `{ projects, projectTemplates, backendBreakdown,
   breakdownLoading, breakdownError }`. App.tsx lee projects del projectStore.
2. **Bug fix F062 aprovechado**: createProject/updateProject/createFromTemplate
   ahora llaman `catalogStore.getState().upsertCustomers()`. Antes mutaban
   `workspace.catalog.customers` (que ya no es fuente de verdad runtime) —
   el customer inline se perdía.
3. **useBackendBreakdownEffect hook en store**: con debounce 300ms + fallback
   + toast. Reemplaza useEffect en App.tsx.
4. **Cross-store unidireccional**: projectStore lee catalogStore vía `getState()`
   para `upsertCustomers`. Lee workspaceStore vía `getState()` para authToken.
5. **markProjectProduced/reopenProject/applyScenarioB reciben `catalog`** como
   parámetro (App.tsx lo pasa desde catalogStore). No muta catálogo.
6. **Deps inyectables** para tests determinísticos.
7. **`workspaceRef` sigue existiendo** en App.tsx — lo usa `setWorkspace`
   wrapper + el botón 'Usar datos demo' (#13) + saveWorkshopSettings. Se
   elimina totalmente en F064.

## Fuera de alcance (próximo slice)

- F064 uiStore + ToastProvider migration: moverá toasts, exportBusy/errors,
  createKeys, command palette. Debería llevar App.tsx finalmente < 1000 L.

## Notas

- App.tsx terminó en 1788 L (objetivo F063 era < 1500). F064 reduce más.
- Los snapshots de Playwright siguen sin estar tracked en main (issue
  preexistente, no de F063).
- `git push` hecho: HEAD local == origin.

## Próximo slice recomendado

**F064 uiStore**: mueve toasts (migración de ToastProvider) + exportBusy/errors
+ createKeys + command palette. Después de F064, App.tsx debería quedar < 1000
L y `workspaceRef` desaparece totalmente.
