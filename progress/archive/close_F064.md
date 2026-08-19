# Close — F064 uiStore Zustand + ToastProvider migration

**Feature:** F064 — phase0_ui_store_toasts (sub-slice 4 de 4 de Fase 0 Perfect App)  
**Branch:** `wip/perfect-app-fase-0-ui` (basada en `main` post-F063)  
**Commit:** principal de F064  
**META issue:** #156 Perfect App roadmap  
**Reviewer:** pendiente

## Qué se hizo

Cierra el sub-slicing F057-F064 (4 stores Zustand). Migra el state interno
de `ToastProvider` + el state UI suelto de App.tsx a un store Zustand nuevo
(`uiStore`). ToastProvider/useToast se eliminan de packages/ui; el renderer
vive ahora en `apps/web/src/components/ToastViewport.tsx`.

### Archivos nuevos

- `apps/web/src/stores/uiStore.ts` (269 L)
- `apps/web/src/stores/uiStore.test.ts` (198 L): 14 behavioral tests
- `apps/web/src/components/ToastViewport.tsx` (108 L)
- `apps/web/src/components/toast.css` (movido)

### Archivos modificados

- `apps/web/src/App.tsx` (1788 → 1796 L)
- `apps/web/src/stores/catalogStore.ts` + `projectStore.ts`: eliminan `toast` de Deps
- `apps/web/src/stores/index.ts`: barrel uiStore
- Tests: catalogStore, projectStore, designSystemShell, ui/index
- `apps/web/package.json`: lucide-react

### Archivos eliminados

- `packages/ui/src/common/Toast.tsx` (293 L)
- `packages/ui/src/common/Toast.test.tsx` (276 L)
- `packages/ui/src/common/toast.css` (movido)

### Verificación ejecutada

| Check | Resultado |
|---|---|
| `pnpm typecheck` (6/6 workspaces) | ✓ verde |
| `pnpm test` (web 185 + desktop 9 + ui + domain/storage/excel) | ✓ verde |
| `./init.sh` | ✓ verde |
| `pnpm visual` (Playwright, 6 screenshots) | ✓ 6/6 sin re-baseline |

## Decisiones de diseño clave

1. **uiStore NO importa de otros stores** — es el más bajo en jerarquía.
   catalogStore y projectStore lo leen vía `getUiStoreState().toast(...)`.
2. **Opción limpia**: catalogStore/projectStore eliminan `toast` de Deps.
3. **Opción eliminar + mover tests**: ToastProvider/useToast borrados de
   packages/ui; behavioral tests migrados a uiStore.test.ts.
4. **Timers module-scoped**: 3 `Map` declarados fuera del store; limpiados por
   `disposeUi()` action para tests.
5. **editingModuleId queda en App.tsx** (va a moduleStore futuro).
6. **commandItems queda como useMemo** en App.tsx (derivado, no state).

## Estado Fase 0 sub-slice 0.1 (4 stores) — COMPLETO

| ID | Feature | Estado |
|---|---|---|
| F057 | workspaceStore | ✅ merged (#157) |
| F062 | catalogStore | ✅ merged (#158) |
| F063 | projectStore | ✅ merged (#159) |
| F064 | uiStore + ToastProvider migration | ✅ done (este PR) |

## Próximo slice

**F058 — Partir ProjectsScreen (2793 L)** en lista + detalle + exports. Eso
es separar la screen, no el state. Debería llevar App.tsx finalmente < 1000 L.

## Notas

- App.tsx terminó en 1796 L. Quedan los handlers de export (van a F058 con
  ProjectsScreen) + helpers de routing.
- `workspaceRef` sigue existiendo para el botón 'Usar datos demo' (#13) +
  saveWorkshopSettings. Se elimina en F058.
- Los snapshots de Playwright ahora están tracked en main (commiteados en
  este PR — resuelve el issue preexistente).
