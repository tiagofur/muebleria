# Review — feature F064

**Veredicto:** APPROVED

**Branch:** `wip/perfect-app-fase-0-ui` (commits `088eada` + `cfa6d26`, todo pushed a origin)
**Feature:** F064 — phase0_ui_store_toasts (sub-slice 4/4 de Fase 0 Perfect App; cierra sub-slice 0.1)

## Verificación ejecutada

| Check | Resultado |
|---|---|
| `git status` limpio | ✓ working tree clean |
| `git log origin/wip/perfect-app-fase-0-ui..HEAD` vacío | ✓ todo pushed |
| `pnpm typecheck` (6/6 workspaces) | ✓ verde |
| `pnpm test` | ✓ 807 tests (domain 217, ui 320, storage 51, excel 25, web 185, desktop 9) |
| `./init.sh` | ✓ verde |
| `pnpm visual` (Playwright, 6 screenshots) | ✓ 6/6 sin re-baseline |
| Diferenciación de feature (diff vs origin/main) | ✓ acotado a F064, sin mezcla |

## Checkpoints

- C1: [x] Harness completo; `./init.sh` exit 0
- C2: [x] Estado coherente; una feature `in_progress`; tests asociados pasan
- C3: [x] Arquitectura respetada (ver detalle abajo)
- C4: [x] Verificación real: typecheck + test + visual verdes
- C5: [x] Sesión cerrada bien: `progress/history.md` actualizado, `close_F064.md` documenta atajos conocidos

## Diseño UI/UX (§4.4 Toasts)

- D1: [x] `toast.css` usa solo tokens CSS del design system (`--surface-card`, `--success-500`, `--space-*`, `--shadow-lg`, `--radius-md`, etc.) — sin hex/px sueltos
- D2: [x] Patrón correcto: top-right (`position:fixed; top: var(--space-4); right: var(--space-4)`)
- D3: [x] Auto-dismiss 4s (`TOAST_DURATION_MS = 4000`), max 3 simultáneos (`TOAST_MAX = 3`), 4 tipos correctos (success/info/warning/error)
- D4: [x] Progress bar con `animation-duration: ${TOAST_DURATION_MS}ms`
- D5: [x] Solo iconos Lucide (`CheckCircle2`, `Info`, `AlertTriangle`, `AlertCircle`, `X`) con `strokeWidth={1.5}`
- D6: [x] Animaciones envueltas en `@media (prefers-reduced-motion: no-preference)` + rama `reduce`

## Análisis por archivo

### Boundary (invariante crítica)

`apps/web/src/stores/uiStore.ts:1-11` documenta y cumple: **uiStore NO importa de otros stores**. Solo importa `zustand` y `ExportIssue` de `@muebles/domain`. Dirección de dependencia correcta:
- `catalogStore.ts:52` importa `getUiStoreState` de uiStore ✓
- `projectStore.ts:45` importa `getUiStoreState` de uiStore ✓
- uiStore es el más bajo en la jerarquía (F057→F062→F063→F064) ✓

### Behavior preservation (Toast.tsx → uiStore.ts)

Comparé `origin/main:packages/ui/src/common/Toast.tsx` vs nuevo `uiStore.ts`:
- `toast()` ingnora mensajes vacíos/whitespace ✓ (uiStore.ts:190-191)
- Cap a `TOAST_MAX` (3): oldest marcado para exit vía `setTimeout(beginExit, 0)` ✓ (uiStore.ts:197-199) — idéntico al original
- Enter→visible a 16ms ✓ (uiStore.ts:215-224)
- `scheduleAutoDismiss` → `beginExit` → `removeToast` tras `TOAST_EXIT_MS` ✓
- `dismiss(id)` ≡ `beginExit(id)` ✓ (igual que el original `dismiss: beginExit`)
- Limpieza de timers: `disposeUi()` limpia los 3 Map module-scoped ✓

### ToastViewport rendering (preserva ToastProvider)

`apps/web/src/components/ToastViewport.tsx` replica **exactamente** el JSX del `ToastProvider` original:
- `createPortal(..., document.body)` ✓ (ToastViewport.tsx:96)
- Mismas clases: `ui-toast-viewport`, `ui-toast`, `ui-toast--${type}`, `is-enter/is-visible/is-exit` ✓
- Mismos `role="status"`, `aria-live="polite"`, `data-testid` ✓
- Mismo `ToastIcon` switch + `ToastCard` + botón close con `aria-label="Cerrar notificación"` ✓
- Guard `typeof document === 'undefined'` preservado (SSR-safe) ✓

### CSS movido intacto

`git diff --find-renames=80%` reporta **similarity index 100%** (rename puro de `packages/ui/src/common/toast.css` → `apps/web/src/components/toast.css`). Sin cambios de tokens.

### Cross-store wiring (catalogStore + projectStore)

- `catalogStore.ts:168-170`: `const toast = (input) => getUiStoreState().toast(input)` — lee fresco en cada llamada, evita stale closures ✓
- `projectStore.ts:253-254`: idem ✓
- `useBackendBreakdownEffect` (projectStore.ts:763-781): eliminó `toast` del array de deps del effect; lee de uiStore dentro del effect ✓
- `depsKey()` actualizado en ambos stores para eliminar `String(deps.toast)` ✓
- `CatalogStoreDeps.toast` y `ProjectStoreDeps.toast` eliminados de las interfaces ✓

### Tests

- `uiStore.test.ts` (14 tests, node env): cubre constants, queue, max 3 + oldest exits, auto-dismiss, manual dismiss, enter→visible, 4 tipos, empty message, export UI, create keys, disposeUi ✓
- Coverage migrado vs `Toast.test.tsx` original (10 tests): **sin pérdida** — todos los behavioral tests están presentes; rendering/portal/Lucide (que eran jsdom+RTL) cubiertos ahora por Playwright
- `catalogStore.test.ts` + `projectStore.test.ts`: mockean `useUiStore.setState({ toast: ... })` para captura; `afterEach` llama `disposeUi()` ✓
- `designSystemShell.test.ts`: actualizado para verificar `<ToastViewport>` + `useUiStore` en lugar de `<ToastProvider>` + `useToast`; agrega aserciones negativas (`not.toContain`) ✓
- `packages/ui/src/index.test.ts` + `packages/ui/src/common/index.ts` + `packages/ui/src/index.ts`: eliminados exports Toast consistentemente ✓

### App.tsx wiring

- `App()` (App.tsx:297-304): elimina `<ToastProvider>`, monta `<ToastViewport />` junto a `<SessionGate />` ✓
- `AppContent` lee `toast` vía `useUiStore((s) => s.toast)` (App.tsx:364) ✓
- `exportErrors/exportBusy/createKeys` migrados a `useUiStore` (App.tsx:591-601); `setX` reemplazados por `bumpX` ✓
- `ensureCatalogStore`/`ensureProjectStore` ya no pasan `toast` en deps ✓

## Atajos conocidos (aceptados, marcados en close_F064.md)

- App.tsx 1796 L (prometía <1300): reducción diferida a F058 (ProjectsScreen split)
- `workspaceRef` y `editingModuleId` permanecen en App.tsx: se eliminan en F058 / futuro moduleStore
- Snapshots Playwright ahora tracked en main (commiteados en este PR — resuelve issue preexistente)
- Trailing whitespace en `progress/close_F064.md` (markdown de progreso, no código): no bloqueante

## Cambios requeridos

Ninguno. La feature está lista para merge.
