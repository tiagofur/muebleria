# Sesión actual

- **Branch:** `feat/piece-labels-edge-banding-96`
- **Issue:** [#96](https://github.com/tiagofur/muebleria/issues/96) — F046 etiquetas + encintado
- **Estado:** implementado — listo para review / PR

## Entregado

1. Domain: `PieceLabel`, `formatEdgeBandingInstruction`, `generatePieceLabels` (solo tablero)
2. PDF: `pieceLabelsPdfExport` en `@muebles/excel`
3. Web: `buildPieceLabelsExport` + botón **Etiquetas** en detalle de proyecto y cola de producción
4. Tests domain / excel / web verdes

## Criterios

- [x] Una etiqueta por línea de pieza de tablero (sin herrajes)
- [x] Instrucción de encintado con lados L1/L2/W1/W2 + canto resuelto
- [x] Export PDF usable (producción / ingeniero, accepted|produced)
- [x] Tests de dominio + PDF

## No hecho (fuera de F046)

- Go parity del generator
- H02/H03 (#97/#98)
