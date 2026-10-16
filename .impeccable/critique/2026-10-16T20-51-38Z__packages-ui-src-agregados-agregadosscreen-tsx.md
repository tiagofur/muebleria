---
target_identity: "file:/Users/tiagofur/dev/carpinteria/muebles/packages-ui-src-agregados-agregadosscreen-tsx"
timestamp: 2026-10-16T20-51-38Z
slug: packages-ui-src-agregados-agregadosscreen-tsx
---
# Critique re-corrida — AGREGADOS (#1009 S1-S5 post-merge)

metadata:
  total_score: 36
  max_score: 40
  mode: Operate
  run: dual-agent (Assessment A sub-agente aislado + Assessment B detector CLI) · browser proof vía organization gate

## Design Health Score

| # | Heurística | Score | Justificación breve |
|---|-----------|-------|---------------------|
| 1 | Visibilidad del estado | 4 | Busy «Guardando…» + banner de fallo con draft intacto + badges por tab (AgregadosScreen.tsx:308, AgregadoEditorForm.tsx:199-210, 172-183). |
| 2 | Match con el mundo real | 4 | «Piezas de tablero», «cajón maderero», «jaladera»; herrajes-por-cantidad vs posicionados-3D distinguidos (AgregadoListView.tsx:33,67, AgregadoEditorForm.tsx:396-400). |
| 3 | Control y libertad | 3 | Confirm-discard, ConfirmDialog en delete, vuelta a lista; delete irreversible sin undo y Duplicar sin feedback (AgregadosScreen.tsx:333). |
| 4 | Consistencia y estándares | 3 | Paridad estructural con Components/Modules; lastran fallback 'HERRAJE' hardcodeado (AgregadoEditorForm.tsx:146) y labels sin htmlFor en Piezas/Herrajes. |
| 5 | Prevención de errores | 4 | Unicidad con conflicto nombrado; guard de identidad #1147 que bloquea y señala la pieza; rol guardado fuera de catálogo visible como «(guardado)». |
| 6 | Reconocer antes que recordar | 3 | Picker con búsqueda, resumen con shortcuts; lastra default ciego de herraje pre-elegido (AgregadoEditorForm.tsx:135-151). |
| 7 | Flexibilidad y eficiencia | 3 | Deep-linking, Duplicar, búsqueda multi-campo es-UY; sin orden/filtro por rol/atajos. |
| 8 | Estética y minimalismo | 4 | CSS tokenizado, cards con jerarquía, 3D sticky, empty states diferenciados. |
| 9 | Recuperación de errores | 4 | Mensajes que señalan y enseñan; error de campo devuelve al tab General. |
| 10 | Ayuda y documentación | 4 | Guía de 3 pasos, hints W/H/D → Piezas → Herrajes, anti doble-conteo, paintModeHint. |
| **Total** | | **36/40** | **Good — desde 24/40 (2026-10-03)** |

## Veredicto de especificidad
Diseño genuinamente de carpintería, no CRUD genérico: defaults y validaciones nacen de bugs reales del dominio (#1147 AGR-PUE-IZQ) y el copy enseña el workflow. Lo genérico restante es capa lista: sin ordenamiento ni filtro por rol, y un default ciego residual en herrajes.

## Fortalezas
1. Guard de identidad #1147: bloquea, señala la pieza y lleva al tab (aprendido de producción).
2. Copy que enseña y diferencia conceptos (costo vs posicionado, «no lo sumes también»).
3. Contrato de guardado sólido con identidad estable mientras se edita.

## Issues restantes (no bloquean la aceptación)
1. Default ciego en herrajes: nueva línea arranca con el primer herraje del catálogo (contradice el estándar S5 para piezas).
2. Fallback 'HERRAJE' hardcodeado cuando no hay option groups.
3. Duplicar sin feedback (ni toast ni navegación a la copia).
4. Labels sin htmlFor/id en tabs Piezas/Herrajes.
5. posText crudo (anchorFace/xFormula) en detalle; card muestra «100 × 0 × 0 mm» con solo W.

## Run Notes
- Assessment A: sub-agente aislado sobre fuentes. Assessment B: detector CLI 0 findings (exit 0).
- Browser: gate local — /add-ons lista+editor con contrato de guardado PASS.
- Comparación vs baseline: 24/40 → 36/40 (+12). S1-S5 verificados en código real, no solo comentarios.
