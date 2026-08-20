# Sesión activa

**Feature:** F118 — shell_critical_bugfixes
**Estado:** Done
**Fecha:** 2026-08-19

## Objetivo

Corregir los bugs críticos del shell detectados por el Judgment Day del Shell (docs/history/judgment-day-shell-2026-08-19.md): clobber de workspace al guardar ajustes, carreras de sesión, descarte silencioso del trabajo guest, navegación rota y exports frágiles.

## Qué se hizo

### S1 — Clobber de workspace (el bug más grave)
- `WorkspaceRepository.saveWorkshopSettings(settings)` agregado a la interfaz con contrato explícito: los adaptadores parchean SOLO settings en el workspace persistido (`localStorageWorkspaceRepository.ts`, `jsonFileStorage.ts`; API ya lo tenía).
- `workspaceStore.saveWorkshopSettings` persiste settings-only (nunca `repository.save()` completo con snapshot stale) con revert solo de settings.
- Nuevo `workspaceSeq` en workspaceStore: contador que se bumpea SOLO en reemplazos totales (load/setWorkspace/login/logout/enterAsGuest/loadDemoWorkspace). Los effects de sync de App.tsx pasaron de deps `[workspace]` a `[workspaceSeq]` — guardar ajustes ya no puede re-inyectar el catálogo/proyectos viejos en los stores.

### S2 — Guardas de sesión
- `loadWorkspace` re-valida la sesión tras el await (resolve tardío post-logout ya no repuebla workspace).
- `projectStore.patch`: 401 en save → `markSessionExpired`; errores de saves que carrerean un logout no toastean en la pantalla de login (guarda de sesión en projectStore y catalog/shared).
- `logout` limpia los singletons: `resetCatalogStore()` / `resetProjectStore()` (exportados, no-op si sin inicializar), invocados desde un effect en `App()` cuando la sesión pasa a null.

### S3 — Guest → login sin descarte silencioso
- `workspaceStore` detecta trabajo guest real (key cruda de localStorage + projects > 0) al loguear → `pendingGuestImport`.
- Modal en App: "Traer a mi cuenta" (`importGuestWorkspace`: push de catálogo+proyectos+plantillas vía repo auth + reload) o "Dejarlo local" (dismiss). Errores inline vía `guestImportError`.

### S4/S5/S6 — Navegación y demo
- `CustomersScreen.onOpenProject` usa `projectPath()` (antes `/cotizaciones/` hardcodeado → aterrizaba en Inicio).
- `rbac.ts`: `'users'` fuera del set nav guest (ítem muerto).
- `loadDemoWorkspace()`: recuperación demo consistente (limpia error/loading, bumpea seq; persiste el seed SOLO en guest — en auth queda session-local para no pisar datos reales).
- `handleLoadCocinaLopezDemo` resuelve el proyecto demo real por id/nombre; fallback a lista de cotizaciones.

### A1 — Exports robustos
- `exportBusy` ahora está respaldado por contador (`exportBusyCount`) — dos exports concurrentes ya no se desbloquean entre sí.
- `exportErrors` se limpian al cambiar de pantalla (effect en navId).
- `guardExport(handler)` envuelve los 14 handlers de export — las excepciones de builders/delivery llegan a toast en vez de unhandled rejection.

## Resultados de Verificación

- `pnpm test`: domain 660 · storage 125 · excel 72 · ui 1124 · web 285 · mobile 36 · desktop 17 — **todos verdes**.
- `pnpm typecheck`: 0 errores.
- `./init.sh`: **100% verde**.

## Tests nuevos

- `workspaceStore.test.ts`: S1 settings-only + seq no-bump; S2 load post-logout; S3 probe/import/dismiss; S6 demo guest/auth.
- `localStorageMigration.test.ts` (storage): patch settings-only no toca el catálogo persistido.
- `uiStore.test.ts`: contador de exportBusy (concurrencia + no negativo).
- Actualizados: settings persist vía saveWorkshopSettings (antes repository.save), tests de toast de error con sesión activa simulada.

## Notas para el reviewer

- La interfaz `WorkspaceRepository` ganó un método requerido — los tres adaptadores lo implementan; los stubs de test también.
- El modal guest-import es SM con dos acciones; texto en español de taller.
- `guardExport` es un wrapper mínimo — F119 lo reemplaza por el helper `runExport` completo.
