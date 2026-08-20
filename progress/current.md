# Sesión activa

**Feature:** Judgment Day SHELL (auditoría, sin feature in_progress)
**Estado:** Exploración/auditoría completada — reporte entregado
**Fecha:** 2026-08-19

## Objetivo

Judgment day del shell: App.tsx (4101 L) + wiring (routes, AppShell, stores de sesión/ui/proyectos). Funciones, bugs, fallos de lógica y persistencia — no solo estructura.

## Qué se hizo

- 2 exploraciones exhaustivas en paralelo: App.tsx profundo + wiring del shell.
- Verificación manual de los 4 hallazgos más graves contra el código.
- Reporte canónico: `docs/history/judgment-day-shell-2026-08-19.md`.
- Features registradas: **F118** `shell_critical_bugfixes` (pending, prioridad alta), **F119** `shell_refactor_slim` (pending, después de F118).

## Hallazgos clave (resumen)

- **S1 (peor bug de los 3 JD hasta ahora)**: `saveWorkshopSettings` construye el workspace desde el snapshot de carga y `repository.save()` re-PUTea catálogo+proyectos+plantillas VIEJOS al server — guardar un ajuste después de editar revierte UI y servidor. Verificado en workspaceStore.ts:294-309 + apiWorkspaceRepository.ts:254-265 + effects App.tsx:583/688.
- S2: carreras de sesión sin guardas (loadWorkspace post-logout repuebla workspace; saves 401 sobre el login; singletons sin limpiar).
- S3: guest→login descarta trabajo guest sin aviso.
- S4: `/cotizaciones/` hardcodeado → cliente→cotización aterriza en Inicio.
- S5: "Usuarios" muerto en sidebar guest.
- A1: 13 handlers de export copy-paste con un solo busy global y errores stale.
- Deuda: bloque compras/stock (~450 L) nunca migrado a store; AppContent ~2600 L.

## Próximo paso

Tomar F118 (bugfixes críticos del shell) y luego F119 (refactor). Siguientes JD sugeridos: Cotizaciones/Proyectos, Producción/Fábrica, Proyectar 3D.
