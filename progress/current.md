# Sesión actual — F064 uiStore + ToastProvider migration

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch activa:** `wip/perfect-app-fase-0-ui` (basada en `main` post-F063)
- **META issue:** #156 Perfect App roadmap
- **Feature:** F064 — phase0_ui_store_toasts (sub-slice 4 de 4 de Fase 0)
- **Iniciada:** 2026-07-21

## Plan F064 (slice aprobado)

1. ✅ Branch + marcar F064 in_progress.
2. Crear `apps/web/src/stores/uiStore.ts` (toasts + exportBusy/errors + createKeys).
3. Mover `Toast.tsx` → `apps/web/src/components/ToastViewport.tsx` + `toast.css`.
4. Modificar `catalogStore` + `projectStore`: eliminar `toast` de deps, leer de uiStore.
5. Migrar App.tsx (eliminar ToastProvider/useToast, leer de uiStore).
6. Mover behavioral tests Toast.test.tsx → uiStore.test.ts + actualizar index.test.
7. Actualizar tests catalogStore/projectStore/designSystemShell.
8. Eliminar Toast.tsx/toast.css de packages/ui + limpiar index.
9. Verificar.
10. Reviewer + push.

## Decisiones clave

- **Opción limpia (invasiva)**: catalogStore/projectStore eliminan `toast` de Deps, leen `getUiStoreState().toast()`.
- **Opción eliminar + mover tests**: ToastProvider/useToast se borran de packages/ui; behavioral tests migran a uiStore.test.
- **uiStore NO importa de otros stores** (es el más bajo en jerarquía).
- **`editingModuleId` queda en App.tsx** (va a moduleStore futuro).
- **`commandItems` queda como useMemo** (derivado, no state).

## Objetivos

- App.tsx 1788 → ~1200 L.
- `ToastProvider` eliminado, reemplazado por `ToastViewport` que lee de uiStore.
- catalogStore/projectStore sin dep `toast`.

## Fuera de alcance F064

- editingModuleId (moduleStore futuro).
- Partir ProjectsScreen (F058).
