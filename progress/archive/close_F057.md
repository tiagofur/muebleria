# Close — F057 workspaceStore Zustand

**Feature:** F057 — phase0_workspace_store (sub-slice 1 de 4 de la Fase 0 Perfect App)  
**Branch:** `wip/perfect-app-fase-0` (basada en `main` post #155 docs/perfect-app-roadmap)  
**Commits:** `5589dc1` (F057 main), commit final (status done)  
**META issue:** #156 Perfect App roadmap  
**Reviewer:** APPROVED → `progress/review_F057.md`

## Qué se hizo

Migró el estado de **sesión + load workspace + RBAC + workshopSettings** desde
`App.tsx`/`SessionGate` a un store Zustand nuevo (`workspaceStore`).
Sub-slice 1 de 4 — el original F057 "los 4 stores" se dividió para que cada PR
sea revisable y los tests frágiles se actualicen en lotes chicos.

### Archivos nuevos

- `apps/web/src/stores/workspaceStore.ts` (428 L): store con sesión, authGate,
  login/register states, workspace lifecycle (load + error), assignableOwners
  fetch (con fallback a authUser), saveWorkshopSettings (resolve + persist +
  revert on failure), media helpers (resolveMediaUrl, uploadCatalogImage).
  Persist middleware solo para `session` (sessionStorage); workspace se
  persiste vía repository como siempre.
- `apps/web/src/stores/workspaceStore.test.ts` (622 L): 30 behavior tests
  cubriendo enterAsGuest, login success/failure, register success/409,
  logout (clears storages), setAuthGate, loadWorkspace success/failure/no-op,
  saveWorkshopSettings (incl. revert on failure), loadAssignableOwners
  (no-op guest / fetch auth / fallback), resolveMediaUrl, uploadCatalogImage,
  selectors.
- `apps/web/src/stores/index.ts`: barrel export.

### Archivos modificados

- `apps/web/package.json`: `zustand ^5.0.14` declarado como dep directa (era
  transitiva por `@react-three/drei`).
- `apps/web/src/App.tsx` (2880 → 2810 L, -70):
  - `SessionGate` simplificado: sin `useState` propios, lee del store.
  - `AppContent`: 3 `useState` migrados (workspace, workspaceLoadError,
    assignableOwners) + 3 `useMemo` (authUser, authToken, repository) ahora
    selectores sobre el store.
  - 2 `useEffect` (assignableOwners fetch, repository.load()) → delegan a
    actions del store (`loadAssignableOwners`, `loadWorkspace`).
  - `saveWorkshopSettings`, `resolveMediaUrl`, `uploadCatalogImage` delegan
    al store (mantienen toasts en App.tsx).
  - `workspaceRef` y `setWorkspace((prev) => ...)` wrapper se mantienen
    locales temporalmente (hasta F062/F063) — documentado en comentarios.
- `apps/web/src/App.test.ts`: test `#13 workspace load failure` reescrito de
  text-matching a behavior test del store + spy en console.error.
- `apps/web/src/designSystemShell.test.ts`: tests `LoginGate` y `Logout`
  reescritos a behavior tests + `beforeEach` con memoryStorage (env node no
  tiene sessionStorage/localStorage globales).
- `feature_list.json`: F057 rescrita (scope reducido a workspaceStore);
  F062/F063/F064 creadas.
- `docs/IDEAS/`: restaurado tras detectar borrado accidental en working tree.

### Verificación ejecutada

| Check | Resultado |
|---|---|
| `pnpm typecheck` (6/6 workspaces) | ✓ verde |
| `pnpm test` (web 120 + desktop 9 + ui 330 + domain/storage/excel) | ✓ verde |
| `./init.sh` (gate local) | ✓ verde |
| `pnpm visual` (Playwright, 6 screenshots) | ✓ 6/6 sin re-baseline |

## Decisiones de diseño clave

1. **Persistencia selectiva**: solo `session` en sessionStorage via Zustand
   `persist` middleware. El workspace se persiste vía el repository
   (`APIWorkspaceRepository` o `LocalStorageWorkspaceRepository`) como
   siempre. No duplicar fuente de verdad.
2. **`getRepository()` como getter del store**: derivado de `session`, mismo
   comportamiento que el `useMemo` previo en App.tsx.
3. **`authToken`/`authUser` como selectors `get()`**: leen de `localStorage`
   on-demand, no se guardan en el store state (siguen siendo fuente única en
   `session.ts`).
4. **`workspaceRef` y wrapper `setWorkspace((prev) => ...)`**: parche temporal
   para no reescribir los ~40 handlers de catálogo/proyecto que usan el
   patrón updater. Se elimina en F062/F063 cuando esos handlers migren.
5. **Deps inyectables en `createWorkspaceStore(options)`**: `baseUrl`,
   `fetchImpl`, `repositoryFactory` → tests determinísticos sin tocar globals.

## Fuera de alcance (próximos slices)

- F062 catalogStore: catálogos + módulos + estructuras + componentes + customers + handlers de mutación.
- F063 projectStore: proyectos + items + templates + backend breakdown.
- F064 uiStore: toasts (migración de ToastProvider) + exportBusy/errors + createKeys + command palette.

## Notas

- App.tsx terminó en 2810 L (objetivo F057 era < 2500). La reducción fuerte
  viene en F062/F063 cuando migren ~1200 L de handlers de catálogo/proyecto.
- Los screenshots de Playwright (`tests/visual/baseline.spec.ts-snapshots/`)
  no están tracked en main (issue preexistente — el commit original #145 los
  dejó en otra branch). F057 no los commitea; fuera de scope.
- `git push` hecho: HEAD local == origin/wip/perfect-app-fase-0 (`5589dc1`).

## Próximo slice recomendado

**F062 catalogStore**. Mueve ~30 handlers de mutación de catálogo y elimina
`patchCatalog` wrapper + `workspaceRef` para catálogo. Después F063 y F064
cierran el estadou de App.tsx < 600 L.
