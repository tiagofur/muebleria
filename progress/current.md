# Sesión activa

**Feature:** Serie nesting de corte CNC — F124 ✅ F125 ✅ F126 ✅ (2026-08-20)
**Estado:** done (sesión cerrada)

## Resumen de la serie

Corte CNC nesting diferenciado del corte con sierra, conforme al plan acordado:

1. **F124 — Motor:** `CutStrategy` en el dominio + MaxRects (`optimizer/nesting.ts`) que mezcla piezas grandes y chicas con espaciado de fresa (`toolSpacingMm`). Default sierra intacto (retrocompatible con planes persistidos).
2. **F125 — DXF:** writer DXF R12 ASCII en `packages/excel` (variantes tableros nesteados / piezas sueltas; capas TABLERO/PIEZA/ETIQUETA/VETA/PERF/RETAZO; sin deps nuevas).
3. **F126 — UI:** selector «Tipo de corte» en el tab Optimización (Ingeniería) + export exclusivo por modo: sierra → PDF + Optimizer XLSX; nesting → DXF.

**Gobernanza:** D5 revisada (production-module.md), prd §6.7.1 y roadmap-comercial-v2 actualizados. D6 vigente: sin post-procesadores de marca.

## Verificación final

- `./init.sh` completo verde: 2338 tests (domain 666, storage 126, excel 79, ui 1129, mobile 36, desktop 17, web 285), 0 features in_progress.
- `pnpm typecheck` verde en los 7 workspaces.
- Las tres features revisadas por reviewer (F124/F125 con verificación algorítmica/estructural independiente; fixes de review aplicados).
- `git push` — HEAD local == origin (`d251d62`).

Detalle por feature: `progress/history.md` (F124/F125/F126) y `progress/review_F12{4,5,6}.md`.
