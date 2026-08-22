# Sesión

**Feature cerrada:** F143 — proyectar_multiselect_align (#310 P3D-1a, meta #308 etapa E3)
**Inicio:** 2026-08-22 · **Cierre:** 2026-08-22
**Subplan (SDD):** https://github.com/tiagofur/muebleria/issues/310#issuecomment-5382120603

## Resultado

Selección múltiple (Shift rango en lista / Ctrl⌘ toggle) sincronizada canvas ↔
lista ↔ inspector ↔ plano 2D con primaria estable; click en vacío limpia sólo
bajo umbral de drag (orbit/pan no toca la selección); auto-prune de claves
huérfanas. Modo detalle "Ver piezas" (pieza/herraje read-only, ESC baja un
nivel). Comandos de dominio puros: duplicate (quantity+1, conserva arreglo
relativo), copy/paste con cursor por muro, pegar a izq/der/esquina, compactar
("Alinear" de muro), distribuir (muro/eje), alinear islas, centrar — todos con
rechazos que enseñan y = 1 entrada de undo (`{layout, itemQuantities}`:
"duplicar → deshacer" restaura plano Y quantities). Barra de acciones
contextual + atajos Ctrl+C/V/D, Delete, Esc con precedencia. Guías temporales
de distancia en drag (capa efímera, cálculo puro `dragGuides.ts`).
`pruneKitchenLayout(+extraInstanceKeys)` mantiene el índice nuevo hasta que
llegue el quantity (patrón extraItemIds de F141).

## Verificación (evidencia)

- `pnpm test` exit 0 — 2.872 tests (domain 972 · storage 153 · excel 89 ·
  ui 1.295 · mobile 45 · desktop 17 · web 301); `pnpm typecheck` exit 0.
- Smoke WebGL Playwright 2/2 (multi-select Meta por lista — Ctrl+click es menú
  contextual en macOS Chromium —, barra "2 seleccionados", Duplicar → plano
  +2 y copias seleccionadas, Escape limpia sin cerrar; screenshots
  `test-results/proyectar-multiselect.png` revisado).
- Review: **APPROVED** con 4 hallazgos aplicados (fallback clash de duplicate,
  split de kitchenLayoutCommands→+kitchenArrangementCommands por soft budget,
  effect de teclado tras early return, patches idempotentes para undo rápido)
  — ver `progress/review_F143.md`.

## Siguiente etapa

E4 / F144 — Precisión (nudge, snap configurable, fit selection) + dimensiones
libres + undo por intención (#310, meta #308). S5/F145 (#313) después.
