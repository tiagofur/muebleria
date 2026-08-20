# Sesión activa

**Feature:** F125 (`dxf_cut_plan_export`) — serie nesting de corte: F124 ✅ → **F125** → F126
**Estado:** in_progress
**Fecha:** 2026-08-20

## Objetivo

Writer DXF R12 ASCII en `packages/excel` que serializa un `CutPlan` generado con estrategia `cnc-nesting` (F124). Dos variantes: `sheets` (tableros nesteados en fila, referencia CAM) y `pieces` (piezas sueltas para software de nesting externo). Capas TABLERO/PIEZA/ETIQUETA/VETA/PERF/RETAZO.

## Bitácora

- [14:46] F124 cerrada (done + history + push). F125 in_progress.
- [14:48] `dxfCutPlanExport.ts` escrito (sin deps nuevas): pares código-valor R12, POLYLINE cerrada por contorno, TEXT con sanitización ASCII (map á/é/ñ/×/·…, ≤250), flecha de veta en VETA, círculos PERF, retazos útiles en RETAZO. Exportado desde `@muebles/excel`.
- [14:48] Golden fixtures generados (UPDATE_GOLDEN=1) + 7 tests: golden sheets/pieces, estructura R12, conteos por capa, ASCII, ValidationError.
- [14:52] Excel 79/79 verde; suite completa 2333 verde; typecheck 7 workspaces.
- [14:55] Review F125: código aprobado (validó DXF con parser propio). Bloqueantes de proceso: falta push + esta bitácora stale. Observación adoptada: PERF ahora filtra a caras proyectables (`front`/`back`) — agujeros de canto no proyectan al plano 2D; test cubre con hole `face:'left'` que no se dibuja.

## Próximo paso

Cerrar F125 (push + done + history) y arrancar F126 (UI): leer `docs/design.md` completo antes de tocar `.tsx`.
