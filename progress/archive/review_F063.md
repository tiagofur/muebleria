# Review — feature F063 (phase0_project_store)

**Veredicto:** APPROVED

**Branch:** `wip/perfect-app-fase-0-project` (basada en `main` post-F062 #158)
**Commits:** `f7eba84` (feat) + `7d7f7f4` (close). HEAD local == origin.

## Resumen de verificación ejecutada

| Check | Resultado |
|---|---|
| `git status` limpio | ✓ (solo untracked preexistente `tests/visual/baseline.spec.ts-snapshots/`) |
| `git log origin/wip/perfect-app-fase-0-project..HEAD` vacío | ✓ todo pushed |
| `pnpm typecheck` (6/6 workspaces) | ✓ verde |
| `pnpm test` (web 171, desktop 9) | ✓ verde. 27 tests nuevos en `projectStore.test.ts`. |
| `./init.sh` | ✓ verde |
| `pnpm visual` (Playwright 6 screenshots) | ✓ 6/6 sin re-baseline |

## Diferencial de archivos (8 archivos, todos esperados)

- `apps/web/src/stores/projectStore.ts` (+851, nuevo)
- `apps/web/src/stores/projectStore.test.ts` (+599, nuevo)
- `apps/web/src/App.tsx` (2261→1788, −473)
- `apps/web/src/stores/index.ts` (barrel +5 exports)
- `apps/web/src/App.test.ts` (4 tests reescritos, sin pérdida de cobertura)
- `feature_list.json` (F063 → `done`)
- `progress/current.md` (estado F063)
- `progress/close_F063.md` (closeout)

Sin mezcla con trabajo ajeno. Sin archivos colgantes de otras features.

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base existen (`AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`).
- [x] Docs existen (`prd.md`, `architecture.md`, `conventions.md`, `verification.md`).
- [x] Skills existen (`leader`, `implementer`, `reviewer`).
- [x] `./init.sh` exit code 0.

### C2 — El estado es coherente
- [x] Cero features en `in_progress` en `feature_list.json` (F063 = `done`; F064 = `pending`).
- [x] Tests de F063 pasan (27 tests nuevos en `projectStore.test.ts`).
- [x] `progress/current.md` describe la sesión F063 cerrada y próximo slice F064.

### C3 — El código respeta la arquitectura
- [x] `projectStore.ts` vive en `apps/web/src/stores/`. `apps/*` puede importar todo (architecture.md §Reglas de boundary). Importa: `react`, `zustand`, `@muebles/domain`, `@muebles/storage`, `@muebles/ui`, y `./catalogStore` (cross-store permitido dentro del mismo paquete).
- [x] No hay lógica de dominio nueva en el shell — solo orquestación de handlers que ya existían. Las funciones del dominio (`transitionProjectStatus`, `createProjectFromTemplate`, `duplicateProject`, `applyRoleChoiceToProject`, `projectToTemplate`, `resolveOwnerOnCreate/Update`) se importan y se invocan; no se reimplementan.
- [x] Errores: la persistencia usa `.catch()` con `console.error` + `toast` (patrón establecido en F057/F062). El hook de breakdown propaga mensaje accionable en español, no stack trace.
- [x] Sin `console.log` de debug nuevos; los `console.error` son en rutas de error de persistencia (igual que el código pre-F063).

### C4 — La verificación es real
- [x] `pnpm test` pasa al 100% (web 171, desktop 9, packages domain/storage/ui/excel).
- [x] Tests de comportamiento en `projectStore.test.ts` cubren: lifecycle (setProjects/setProjectTemplates), CRUD (createProject/updateProject/deleteProject/duplicate), transiciones de estado (markProduced/reopen), templates (saveAsTemplate/createFromTemplate/deleteTemplate), mutaciones de items (add/update/remove), updateProjectLevelChoices, applyScenarioB gating, duplicateWithScenarioB con callback de navegación, importNestingResult, updateKitchenLayout (vacío vs no-vacío), y cross-store upsertCustomers.
- [x] Hook `useBackendBreakdownEffect`: test mínimo de contrato (typeof function). La cobertura de comportamiento completa (debounce, fallback, toast) se difiere a Playwright + App.test.ts (#11/#12 reescritos apuntan al hook).
- [x] Deps inyectables (`newId`, `createProject`, `saveProject`, etc.) hacen los tests determinísticos (sin `crypto.randomUUID` aleatorio).
- [n/a] No hay golden test de export ni de motor en este slice.

### C5 — La sesión se cerró bien
- [x] Sin untracked sospechosos (solo `tests/visual/baseline.spec.ts-snapshots/` — issue preexistente declarado en el brief, no de F063).
- [ ] `progress/history.md` no tiene entrada para F063. **Observación:** tampoco la tiene para F057 ni F062 (patrón preexistente del repo desde 2026-07-15). No bloquea F063; sería deseable agregar entradas de history para los 3 sub-slices ya mergeados.
- [x] F063 marcado `done` en `feature_list.json`.
- [x] `progress/current.md` refleja F063 cerrada y F064 como próximo slice.
- [x] HEAD == origin (todo pushed).

## Puntos específicos pedidos en el brief

### Boundaries (architecture.md)
`projectStore.ts` es `apps/web`. Puede importar todo. Respeta la tabla. ✓

### Cross-store unidireccional
- `projectStore.ts` (líneas 43–44) importa `{ ToastFn, getCatalogStoreState }` de `./catalogStore`.
- `catalogStore.ts` **no** importa nada de `./projectStore` (verificado con grep).
- `workspaceStore.ts` **no** importa nada de `./projectStore` ni `./catalogStore`.
- El acceso runtime es vía `getCatalogStoreState()` dentro del cuerpo del handler, no en top-level — esto evita cualquier posibilidad de ciclo de módulo.
- `useBackendBreakdownEffect` lee `_lastDeps` (fetchImpl/baseUrl/getAuthToken) sincronizado por `ensureProjectStore`, que es idempotente por `depsKey` y refresca `_lastDeps` en cada llamada (línea 721).

### Hook `useBackendBreakdownEffect` — preservación de comportamiento
Comparado `useEffect` original (App.tsx pre-F063) vs nuevo hook (projectStore.ts líneas 770–851):

| Aspecto | Original | Nuevo | OK |
|---|---|---|---|
| Debounce | 300ms hardcoded | `BACKEND_BREAKDOWN_DEBOUNCE_MS = 300` | ✓ |
| Session guard | `session !== 'auth' \|\| !selectedProjectId \|\| !selectedProject` → clear all + return | idéntico | ✓ |
| URL | `${DEFAULT_API_BASE}/projects/${selectedProjectId}/calculate` | `${baseUrl}/projects/${projectId}/calculate` (baseUrl = `_lastDeps.baseUrl` = `DEFAULT_API_BASE`) | ✓ |
| Auth header | condicional `token ? { Authorization: \`Bearer ${token}\` } : {}` | idéntico | ✓ |
| breakdownFromApi | importado de `@muebles/storage` | idéntico | ✓ |
| Error path | `console.error` + setBackendBreakdown(null) + setBreakdownError(message) + toast | idéntico (vía `store.setState`) | ✓ |
| Loading state | true al inicio, false en finally | idéntico | ✓ |
| `active` guard | previene set tras unmount | idéntico | ✓ |
| Cleanup | `clearTimeout(timeoutId)` | idéntico | ✓ |
| Deps | `[selectedProjectId, selectedProject, session, toast]` | `[projectId, project, session, toast]` | ✓ |

Sin drift. Mensaje "mostrando valores locales" preservado (verificado en App.test.ts #12).

### Bug fix F062 (upsertCustomers)
- `createProject` (línea 332): llama `getCatalogStoreState().upsertCustomers(resolved.customers)` después de `transitionProjectStatus` y antes de `set(...)`. Orden correcto — customers se persisten antes del toast de éxito.
- `updateProject` (línea 383): mismo patrón.
- `createFromTemplate` (línea 496): mismo patrón.
- `upsertCustomers` (catalogStore.ts línea 705): reemplaza customers y persiste vía `saveCatalog(nextCatalog)` fire-and-forget.
- Tests cubren los 3 caminos:
  - `projectStore.test.ts:196` — crea customer nuevo y verifica que está en catalogStore.
  - `projectStore.test.ts:221` — no-op cuando customerId ya existe.
  - `projectStore.test.ts:391` — createFromTemplate crea customer nuevo.

Antes del fix, el customer inline se perdía porque `workspace.catalog.customers` ya no era fuente de verdad runtime. Ahora persiste vía el store correcto.

### Tests reescritos en App.test.ts — sin pérdida de cobertura
4 tests reescritos:
1. **"#15 setState side effects"** — antes assertaba `patchProjects((ps) =>` en App.tsx. Ahora asserta que `patchProjects` ya no está en App.tsx y que projectStore expone `projects: readonly Project[]`. Cubre la migración.
2. **"createProject builds id outside setWorkspace"** — antes buscaba el bloque en App.tsx. Ahora busca el bloque en projectStore y valida `id: newId()` + `persistCreateProject(project)`. Cubre invariante StrictMode.
3. **"#11 calculate path"** — antes assertaba `DEFAULT_API_BASE` + `readAuthToken` en App.tsx. Ahora asserta lo mismo en projectStore (donde migró el hook). Cubre no-hardcode.
4. **"#12 breakdown loading/error"** — sigue verificando que los props `breakdownLoading`/`breakdownError` se cablean a ProjectsScreen desde App.tsx; además verifica que el mensaje de fallback y el toast `type: 'error'` viven en projectStore.

Cobertura preservada — los assertions migraron al archivo correcto, no se eliminaron.

### Mezcla con trabajo ajeno
No. El diff toca únicamente: projectStore (nuevo), projectStore.test (nuevo), App.tsx (migración), App.test.ts (tests migrados), stores/index.ts (barrel), y los 3 archivos de progreso/feature_list. Cero archivos de otra feature.

## Observaciones menores (no bloqueantes)

1. **App.tsx quedó en 1788 L** (objetivo F063 era < 1500). Declarado en el brief como atajo que no cuenta: F064 reduce más. Tomar nota para F064.
2. **`workspaceRef` sigue existiendo** en App.tsx. Declarado: se elimina en F064.
3. **`upsertCustomers` se invoca incluso cuando no hay customer nuevo** (caso `customerId` existing en draft). `resolveCustomerFromDraft` retorna `customers: [...customers]` (copia), y `upsertCustomers` reemplaza con la misma lista → dispara `saveCatalog` innecesario. Es ineficiencia menor, no bug — el test en `projectStore.test.ts:221` valida que la lista no cambia estructuralmente. Podría optimizarse en F064 si se quiere.
4. **`progress/history.md` sin entradas para F057/F062/F063.** Patrón preexistente. Deseable agregar de manera retrospectiva.
5. **`useBackendBreakdownEffect` solo tiene test de contrato** (typeof function) en projectStore.test.ts porque jsdom no está configurado para este archivo. La cobertura funcional vive en App.test.ts #11/#12 (asserts sobre el código fuente del hook) y en Playwright. Aceptable.

## Conclusión

Migración limpia y atómica del slice de proyecto. 19 handlers + hook de backend breakdown movidos sin behavior drift. Bug fix F062 bien aplicado y testeado. Cross-store unidireccional sin ciclos. Typecheck/tests/init.sh/visual todos en verde. Trabajo pushed.

**APPROVED** — listo para abrir PR y mergear a main.
