# Review — feature F057 (phase0_workspace_store)

**Veredicto:** APPROVED

## Resumen

F057 migra el estado de sesión + carga de workspace + RBAC + workshopSettings
de `App.tsx`/`SessionGate` a un store Zustand (`workspaceStore.ts`), con persist
selectivo (solo `session` en sessionStorage) y tests de comportamiento. El
sub-slicing (F057/F062/F063/F064) está documentado en `feature_list.json` y
`progress/current.md`.

## Verificación ejecutada

| Check | Resultado |
|---|---|
| `git status` limpio (solo untracked preexistente `baseline.spec.ts-snapshots/`) | OK |
| `git log origin/wip/perfect-app-fase-0..HEAD` vacío (todo pushed) | OK (HEAD == origin == `5589dc1`) |
| `pnpm typecheck` (6/6 workspaces) | OK |
| `pnpm test` (web 120 + desktop 9 + ui 330 + domain/storage/excel) | OK |
| `./init.sh` | OK ([OK] Entorno listo) |
| `pnpm visual` (6 screenshots Playwright) | OK (6/6 sin re-baseline) |

## Checkpoints

- C1: [x] AGENTS.md, init.sh, feature_list.json, progress/current.md,
  CHECKPOINTS.md, docs/{prd,architecture,conventions,verification}.md, los 3
  skills — todos presentes. `./init.sh` exit 0.
- C2: [x] Una sola feature `in_progress` (F057). `progress/current.md` describe
  la sesión activa correctamente.
- C3: [x] `packages/domain` no importa React/electron/fs/xlsx (no se tocó en
  este PR). `workspaceStore.ts` es `apps/web` (shell) e importa
  `zustand` + `@muebles/domain` + `@muebles/storage` — permitido por
  `docs/architecture.md` ("apps/* pueden importar todo lo anterior"). Errores
  son instancias de `Error` con mensajes accionables en español. Solo
  `console.error` (3 usos para logs de error en catch paths, none en domain).
- C4: [x] `pnpm --filter @muebles/domain test` pasa. Sin tocar export ni
  golden — F057 es un refactor de UI shell, no toca motor. Tests de storage
  siguen usando tmp real.
- C5: [x] Sin archivos sospechosos sin trackear (el único untracked es
  `tests/visual/baseline.spec.ts-snapshots/`, preexistente a F057 y explícito
  en el contrato de revisión). `progress/current.md` en plantilla limpia.

## Diseño UI/UX

No aplica — F057 es refactor de arquitectura, sin cambios de UI/UX. Las 6
screenshots de Playwright pasaron sin re-baseline, confirmando paridad visual.

## Puntos clave verificados

### Boundaries (`docs/architecture.md`)
- `workspaceStore.ts` solo importa `zustand`, `@muebles/domain` (tipos +
  `resolveWorkshopSettings`), `@muebles/storage` (`APIWorkspaceRepository`,
  `LocalStorageWorkspaceRepository`, `WorkspaceRepository`), y `../session`
  (helpers locales del shell). 100% permitido para `apps/web`.
- `apps/web/src/stores/index.ts` (barrel) reexporta sin lógica extra.

### Conventions (`docs/conventions.md`)
- Tipos `readonly` en `WorkspaceState`, `AssignableOwner`, `WorkspaceStoreDeps`,
  `RepositoryFactory` (workspaceStore.ts:42-66, 73-125).
- Naming: `camelCase` para funciones/variables, `PascalCase` para interfaces.
- Comentarios explican por qué (ej. workspaceStore.ts:38-46 RBAC, :84-87
  workspace lifecycle, :254-256 #13 silent seed, :280 revert on failure,
  :382-390 merge strategy).
- Tests Vitest con fixtures (`createSeedWorkspace`, `makeStubRepo`,
  `memoryStorage`, `AUTH_USER`). Cubren happy path + error paths + edge cases.
- 30 tests en `workspaceStore.test.ts` + 13 en `designSystemShell.test.ts` +
  28 en `App.test.ts`.

### Tests de comportamiento
- `App.test.ts` #13 (líneas 109-142): reescrito de text-matching sobre
  App.tsx a behavior test del store (failingRepo + `loadWorkspace` + assert de
  `workspace === null && workspaceLoadError === 'backend down'`). Conserva
  cobertura del invariante #13 (no silent seed). Console.error spy silencia
  ruido esperado.
- `designSystemShell.test.ts` Slice E (141-162) y Slice F (188-213):
  reescritos a behavior tests del store (`createWorkspaceStore()` + assert de
  tipos de acciones + flow completo login/logout). Mantienen asserts
  estructurales sobre App.tsx que siguen siendo válidos
  (`LoginScreen`, `SessionGate`, `onLogout={logout}`).
- Sin pérdida de cobertura observable: los asserts text-matching eliminados
  eran sobre strings internos de App.tsx que ya no existen post-migración.

### Persistencia (no duplicación)
- `workspaceStore` persiste SOLO `session` en `sessionStorage` bajo clave
  `muebles-workspace-store` (workspaceStore.ts:380 `partialize`).
- `workspace` (catálogo + projects + settings) sigue siendo persistido por
  `LocalStorageWorkspaceRepository` bajo `muebles_guest_workspace` en
  `localStorage` (packages/storage/src/localStorageWorkspaceRepository.ts:10).
- Storages distintos, concerns distintos, sin doble fuente de verdad.

### Stale closures (`workspaceRef`)
- `workspaceRef.current = workspace` se ejecuta en cada render
  (App.tsx:530) — siempre sincronizado con el store.
- `setWorkspace` wrapper (App.tsx:546-563) lee `useWorkspaceStore.getState().workspace`
  directamente en lugar de capturar `workspace` por closure — evita stale reads.
- `patchCatalog`/`patchProjects` (App.tsx:792-833) mutan `workspaceRef.current`
  antes de `setWorkspace(next)` — consistencia síncrona.
- `saveWorkshopSettings` (App.tsx:1561-1576) re-syncs desde
  `useWorkspaceStore.getState().workspace` después de la acción (línea 1566).
- Sin bugs observables de stale closure.

### Sub-slicing documentado
- `feature_list.json`: F057 rescrita (scope = workspaceStore solamente),
  F062/F063/F064 creadas como `pending` con dependencias explícitas
  ("Depende de F057 cerrado").
- `progress/current.md` documenta las decisiones de sub-slicing aprobadas.
- El commit msg (5589dc1) detalla el alcance y qué queda pendiente.
- No se mezcló trabajo de otra feature — todos los archivos tocados son
  cobertura de F057.

### Notas
- `App.tsx` = 2810 líneas (objetivo F057 acceptance < 2500). El usuario
  marcó explícitamente este atajo como NO issue (el objetivo < 600 llega al
  cerrar F062+F063+F064 cuando ~1200 líneas de handlers de catálogo/proyecto
  migren). Se acepta por indicación directa del coordinador.
- `workspaceRef` + `setWorkspace((prev) => ...)` wrapper permanecen en
  App.tsx como parche temporal explícitamente documentado (App.tsx:526-528,
  539-545) hasta F062/F063.

## Cambios requeridos

Ninguno. Aprobado.
