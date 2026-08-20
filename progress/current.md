# Sesión activa

**Feature:** Judgment Day COMPRAS/ALMACÉN (auditoría, sin feature in_progress)
**Estado:** Exploración/auditoría completada — reporte entregado
**Fecha:** 2026-08-20

## Objetivo

Judgment day de Compras/Almacén completo: pantallas, store, derivaciones, dominio, persistencia TS (localStorage + API) y backend Go — funciones, bugs, fallos de lógica y persistencia.

## Qué se hizo

- 3 exploraciones exhaustivas en paralelo: UI/store, dominio+persistencia TS, backend Go.
- Verificación manual de los 3 hallazgos críticos contra el código (doble-revert, poNumber, receive).
- Reporte canónico: `docs/history/judgment-day-compras-almacen-2026-08-20.md`.
- Features registradas: **F122** `purchasing_critical_bugfixes` (pending, prioridad máxima), **F123** `purchasing_hardening_tests` (pending).

## Hallazgos clave (resumen)

- **C1 (peor)**: desmarcar picking dos veces acredita dos veces el mismo despacho — el filtro `!m.revertsId` no distingue revertidos; server sin unique en reverts_id, sin check ya-revertido y monto sin validar.
- **C2**: números de OC = OC-+3hex (4096 valores) con UNIQUE → 500s tras ~75 pedidos; duplicados silenciosos en guest.
- **C3**: recibir una OC acredita stock de líneas ajenas sin tope (inventario libre por POST).
- Altos: ventana 200 movimientos del revert, carrera en togglePick, débitos por paquete (no neto), tableros sin débito cuando falta sheetEstimate, validación de signos ausente en TS, race de UpdatePO que reescribe items de emitidas, despachos huérfanos al cambiar stage, unidades herrajes inconsistentes.
- **Cero tests del purchasingStore** (donde viven los bugs) y cero tests de storage Go contra Postgres real.

## Próximo paso

Tomar F122 (bugfixes críticos de inventario) y luego F123. Siguientes JD: Cotizaciones/Proyectos, Producción, Proyectar 3D.
