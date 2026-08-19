# Sesión activa

**Feature:** F114 — warehouse_dashboard_separation
**Estado:** Done
**Fecha:** 2026-08-19

## Objetivo
Separar la pantalla operativa de Almacén/Compras de las métricas/estadísticas, creando el nuevo `WarehouseDashboard` (`/warehouse-dashboard`) e integrándolo al menú `COMPRAS / ALMACÉN` y RBAC.

## Tareas
- [x] Dominio & RBAC: métricas analíticas de almacén en `packages/domain/src/purchasing.ts` (`computeWarehouseDashboardStats`) y permisos en `rbac.ts` (`roleCanAccessWarehouseDashboard`).
- [x] Tests de dominio en `purchasing.test.ts` y `rbac.test.ts`.
- [x] UI Component `WarehouseDashboard.tsx` con KPIs de proyectos, demanda de tableros/cintillas/herrajes, salud de stock, alertas de reposición, órdenes de compra y tabla de proyectos.
- [x] UI Component `PurchasingScreen.tsx` refactorizado como espacio operativo limpio con `onOpenDashboard`.
- [x] Estilos CSS en `purchasing.css` con tokens `--area-work-*` y `.stat-card`.
- [x] Shell & Navegación: `AppShell.tsx` (sidebar con `Dashboard Almacén` primero), `routes.ts` (`/warehouse-dashboard`) y `App.tsx`.
- [x] Tests UI y de integración completos. `./init.sh` y `pnpm typecheck` 100% verdes.
