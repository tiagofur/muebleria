---
target_identity: "file:/Users/tiagofur/dev/carpinteria/muebles/packages-ui-src-components"
timestamp: 2026-10-16T20-51-59Z
slug: packages-ui-src-components
---
# Critique re-corrida — COMPONENTES (#1019 C1-C5 post-merge)

metadata:
  total_score: 35
  max_score: 40
  mode: Operate
  run: dual-agent (Assessment A sub-agente aislado + Assessment B detector CLI) · browser proof vía organization gate

## Design Health Score

| # | Heurística | Score | Justificación breve |
|---|-----------|-------|---------------------|
| 1 | Visibilidad del estado | 4 | «Guardando…» en CTA, «Fijando…» en excepción, banner de save rechazado con draft intacto (ComponentsScreen.tsx:565, ComponentEditorJoineryPanel.tsx:248, ComponentEditorForm.tsx:125-136). |
| 2 | Lenguaje del taller | 4 | «Encintado», «Placa», L1/W1 traducidos a aristas físicas, placeholders heredados en mm (PlankEdgeDiagram.tsx:63-87, JoineryPanel:367-401). |
| 3 | Control y libertad | 4 | Descarte con confirmación voseo, «Restaurar herencia», confirmación inline antes de desactivar. |
| 4 | Consistencia y estándares | 3 | K5 aplicado con patrón #1032 (header cede al EmptyState); misma métrica llamada «Geometría» en card y «Placa» en chrome. |
| 5 | Prevención de errores | 4 | Validación con salto automático a la pestaña culpable, fórmulas pre-evaluadas, guard anti-rol-ambiguo, save rechazado no cierra. |
| 6 | Reconocer antes que recordar | 3 | Guía de variables colapsable, leyenda persistente del diagrama, hints de procedencia; falta un ejemplo trabajado de fórmula. |
| 7 | Flexibilidad y eficiencia | 3 | Deep-links, diagrama 100% teclado, search con debounce; Duplicar exige detail → Más. |
| 8 | Estética y minimalismo | 4 | Jerarquía clara, disclosures solo cuando aplica, copy de solo lectura honesto. |
| 9 | Recuperación de errores | 4 | Mensajes nombran al ofensor; recovery enseña el próximo paso; role="alert" en excepción. |
| 10 | Ayuda y documentación | 3 | Intro que enseña consecuencia; falta ejemplo real de fórmula para el primerizo. |
| **Total** | | **35/40** | **Good — desde 26/40 (2026-10-04)** |

## Veredicto de especificidad
«Escrita por alguien que conoce un taller»: el diagrama de cantos mapea códigos internos a aristas físicas con proporción real; el JoineryPanel expone la escalera de procedencia Biblioteca → Fábrica → Componente con su origen exacto; los dims default existen para que las fórmulas resuelvan desde el primer minuto.

## Fortalezas
1. Contrato de guardado C1 con copy de recuperación que enseña el próximo paso.
2. Diagrama de cantos C2: aria-pressed, focus ring, hit-stroke para touch, leyenda código→arista.
3. K5 bien aplicado: header cede el CTA al EmptyState sin duplicar acciones.

## Issues restantes (no bloquean la aceptación)
1. Duplicar enterrado (detail → Más) sin atajo desde las cards.
2. Métrica con dos nombres: «Geometría» vs «Placa».
3. Guía de fórmulas sin ejemplo real ni set de funciones soportadas.
4. Dims de contenedor volátiles (useState sin persistencia entre sesiones).
5. Sin gestión de foco al validar (el alert existe, el foco no se mueve).

## Run Notes
- Assessment A: sub-agente aislado sobre fuentes. Assessment B: detector CLI 0 findings (exit 0).
- Browser: gate local — /components lista+editor con contrato de guardado PASS.
- Comparación vs baseline: 26/40 → 35/40 (+9). C1-C5 verificados en código real; el patrón K5 de #1032 se aplicó y verificó en vivo durante esta re-corrida.
