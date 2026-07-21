# Close — F062 catalogStore Zustand

**Feature:** F062 — phase0_catalog_store (sub-slice 2 de 4 de Fase 0 Perfect App)  
**Branch:** `wip/perfect-app-fase-0-catalog` (basada en `wip/perfect-app-fase-0` post F057)  
**Commit:** `f8b4f10`  
**META issue:** #156 Perfect App roadmap  
**Reviewer:** pendiente

## Qué se hizo

Migró el **slice de catálogo completo** (28 handlers de mutación) desde
`App.tsx` a un store Zustand nuevo (`catalogStore`). `catalogStore` POSEE su
catálogo; `workspaceStore` dropea `catalog` de su workspace.

### Archivos nuevos

- `apps/web/src/stores/catalogStore.ts` (802 L): store con state
  `{ catalog: Catalog | null }` + 28 actions + media helpers. Cross-store lee
  workspaceStore vía `useWorkspaceStore.getState()` (authToken, session, draft
  count para #138). `ensureCatalogStore(deps)` corre en el body del componente
  (no en useEffect) para que el store exista antes del primer render.
- `apps/web/src/stores/catalogStore.test.ts` (566 L): 30 behavior tests con
  deps inyectables. Cubre actions simples + atípicas.
- `apps/web/src/stores/catalogMappers.ts` (173 L): draft → entity mappers
  extraídos de App.tsx.

### Archivos modificados

- `apps/web/src/App.tsx` (2810 → 2261 L, **-549**):
  - Eliminado `patchCatalog` wrapper.
  - Eliminados los 28 handlers de catálogo (reemplazados por asignaciones
    directas del store; 4 wrappers usan useCallback para closures).
  - Eliminados helpers `draftToModule/Structure/Component`.
  - Eliminados `resolveMediaUrl`/`uploadCatalogImage` locales (delegan al
    store; toast de upload sigue en App.tsx).
  - `workspaceRef` ya no se usa para catálogo.
- `apps/web/src/stores/index.ts`: barrel actualizado.
- `apps/web/src/App.test.ts`: test `#15` reescrito.
- `apps/web/src/designSystemShell.test.ts`: test `F019 toasts` reescrito.

### Bug fix aprovechado
- `cotización${count === 1 ? '' : 'es'}` → `count === 1 ? 'cotización' :
  'cotizaciones'`. El plural del #138 estaba mal (cotizaciónes).

### Verificación ejecutada

| Check | Resultado |
|---|---|
| `pnpm typecheck` (6/6 workspaces) | ✓ verde |
| `pnpm test` (web 144 + desktop 9 + ui + domain/storage/excel) | ✓ verde |
| `./init.sh` (gate local) | ✓ verde |
| `pnpm visual` (Playwright, 6 screenshots) | ✓ 6/6 sin re-baseline |

## Decisiones de diseño clave

1. **catalogStore POSEE su catálogo** (decisión del usuario D-posesión). Más
   limpio arquitectónicamente que coordinar con workspaceStore; `Workspace`
   pasa a ser view model ensamblado al cargar.
2. **`ensureCatalogStore()` en body del componente, no en useEffect**: los
   efectos corren después del primer render; los hooks que leen del store
   crashean en paint. Idempotente vía `depsKey`.
3. **Cross-store unidireccional**: catalogStore lee workspaceStore vía
   `getState()`. No hay import directo en top-level (evita ciclo).
4. **Deps inyectables**: `newId`, `saveCatalog`, `toast`, `fetchImpl`,
   `getAuthToken`, `getSession`, `getDraftProjectsCount` → tests
   determinísticos sin tocar globals.
5. **`upsertCustomers()` acción pública**: createProject/updateProject/
   createFromTemplate (todavía en App.tsx hasta F063) la usan para persistir
   customers desde el flujo de proyecto.
6. **`deleteModule(id, onModuleDeleted?)` callback**: permite que App.tsx
   resetee `editingModuleId` sin necesidad de un store de UI.

## Fuera de alcance (próximos slices)

- F063 projectStore: handlers de proyecto (createProject, updateProject,
  addProjectItem, etc.). Migrará los ~700 L restantes.
- F064 uiStore + ToastProvider migration.

## Notas

- App.tsx terminó en 2261 L (objetivo F062 era < 2000). Quedan ~260 L fuera,
  cubiertos por F063.
- Los screenshots Playwright siguen sin estar tracked en main (issue
  preexistente, no de F062).
- `git push` hecho: HEAD local == origin.

## Próximo slice recomendado

**F063 projectStore**: mueve ~20 handlers de proyecto + backend breakdown
useEffect. Después de F063, App.tsx debería quedar < 1200 L y `workspaceRef`
desaparece totalmente.
