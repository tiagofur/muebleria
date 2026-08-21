# Sesión activa

**Feature:** F130 — Export DXF de perforaciones por cara + reporte (perforaciones CNC — 4/5)
**Estado:** implementada, esperando review
**Inicio:** 2026-08-21 (tarde)

## Plan

1. Leer wiring existente: dxfCutPlanExport (drillingByPiece de cb21e4a), useExportHandlers:437
   (no pasa drilling), exportProductionPack, useProductionOrderDocuments (reporte), partDrillingExport.
2. Dominio: ensamblador real — BOM parts + join instancias→partId + placements manuales +
   derived joints (F129) → resolvePartDrilling por pieza → patrones (schema v1 compatible).
3. DXF: capas por cara+tipo+Ø (PERF_F_/PERF_B_ espejada/CANTO), convención documentada.
4. Reporte: fuente real del motor, schema muebles.drilling-data.v1 intacto.
5. Wiring: panel Ingeniería pasa drilling al DXF; pack ZIP incluye datos reales.
6. Goldens + suite + reviewer + cierre.

## Bitácora

- 2026-08-21: F129 cerrada (APPROVED). Serie: F127-F129 done. F130 in_progress.


## Bitácora (implementación F130)

- **Dominio**: `generateCutRowsWithLinks` (cut.ts refactor — rows + links con
  partId/labelRef/part por línea; generateCutRows delega) y `resolveProjectDrilling`
  (projectDrilling.ts): por pieza une placements manuales (instancias estructura+
  módulo vía convención `-copy-N`) + derived joints (F129, con reglas del structure
  si las tiene) y resuelve con el motor F128. Patterns keyeados por labelRef
  (único por línea); data en schema muebles.drilling-data.v1 intacto. Piezas sin
  herraje caen al fallback F074 marcado. Tests 5/5 (gabete real: minifix+pernos,
  bisagras Ø35×2 en puerta, pasantes en fondo, sin issues; quantity no duplica).
- **DXF**: capas dinámicas por cara+Ø — PERF_F<Ø> / PERF_B<Ø> (back ESPEJADO en
  eje ancho: el operador voltea y corre las coordenadas tal cual) /
  PERF_CANTO<Ø> (proyectado al canto); profundidad vive en el reporte (capa=tool).
  Join por labelRef con fallback partCode. Layer table dinámico (colores 4/1/6).
  Goldens regenerados por UPDATE_GOLDEN (delta = capas nuevas + círculos en ellas).
- **Wiring**: handleExportCutPlanDxf pasa drilling real (best-effort);
  reporte del hub con fuente real + fallback heurístico (catalog enhebrado
  Workspace→Hub→hook); pack ZIP incluye `perforaciones_<obra>.json` real.
- Suite 2444, typecheck 7/7. Deuda no mezclada: agregado-scoped manual placements (F131).
