# #1534 — Catálogo › Perfiles de gola: editor v2

Lane: Delegated Direct (backend acotado + web + e2e). Writer: esta sesión (worktree `1534-perfiles-v2`, rama `feat/1534-gola-profile-editor`, base origin/main 7fc8187f).
Prerrequisito UX: brief publicado y aprobado por el owner (comentario en la issue, 2026-11-08); suposiciones 1–5 honradas.

## Alcance ejecutado
1. Preview server-side (suposición 2): POST /api/catalog/opening-profiles/preview — engine.GolaProfilePreviewSentences resuelve con el A3 #1529: una puerta exacta (H − D), columna canónica de 2 frentes para el entre frentes (con el descuento superior solo si esa posición está declarada con él), línea honesta «falta el descuento …» por posición sin descuento (nunca altura inventada ni preview bloqueado entero). POST-as-read, sin catálogo ni storage.
2. Editor v2 (suposición 4): escribe SIEMPRE v2-shaped (material/posiciones/descuentos; el bridge #1530 mantiene coherentes grip_type/compatible_placements/door_reduction_mm). Reemplaza al modal #1526 (eliminado con su test). Barrera de ficha retirada.
3. Vista previa + dibujo esquemático SVG declarativo de los campos (suposición 3).
4. Efectos en texto llano; italiana pre-carga 36/36 + tira 70 + bisel prof−2 + muesca por espesor de tira + 1.
5. Piezas por rol (#1526): Perfil/Soportes/Tapas/Tira.
6. Lista con columna Uso por posición (disponible ≠ válido, verbatim de la API).
7. Fix de dominio: el puente #1530 es SIMÉTRICO — compatible_placements alimenta positions en escrituras v2-shaped (la UI del editor declara por compatible_placements; sin esto el create llegaba con cero posiciones).

## Evidencia
- Backend: engine + handler tests verdes (680 exacto, italiana 684/324, C-solo 342, honestas «falta», rechazos).
- Unit UI: draft v2 (material/descuentos/height_mm tira/bridge coherente), catálogo (chips, italiana preset, preview server-side verbatim, línea honesta, sugerencia→680) — 214 archivos / 2465+ tests verdes.
- E2E gate PASS: crear Gola L (sugerencia 40 → «una puerta = 680»), Italiana 70 (36/36, bisel 25.2 = 27.2−2, tira 70), estilo «Estilo 1534» que usa ambos (resumen del Agarres con L arriba + Italiana entre cajones). Screenshots en docs/demo/evidence/1534/.
- CI: 22/22 en el HEAD final.

## Entrega
Un PR contra main. Completo respecto del alcance (ítems 1–6 + aceptación 1–4).
