# #1534 — Catálogo › Perfiles de gola: editor v2

Lane: Delegated Direct (backend acotado + web + e2e). Writer: esta sesión (worktree `1534-perfiles-v2`, rama `feat/1534-gola-profile-editor`, base origin/main 7fc8187f).
Prerrequisito UX: brief publicado y aprobado por el owner (comentario en la issue, 2026-11-08); suposiciones 1–5 honradas.

## Alcance ejecutado
1. Preview server-side (suposición 2): POST /api/catalog/opening-profiles/preview — engine.GolaProfilePreviewSentences resuelve con el A3 #1529 a través de ResolveOpeningEdgeStack con los inputs canónicos del fixture (holguras 1.5/1.5, gap 3; el agarre absorbe la zona): una puerta = H − D exacto; columna de 2 frentes ((H − superior − entre)/2 con agarre superior; (H − 3 − entre)/2 sin él → 340.5, fixture «sólo gola C»); línea honesta «falta el descuento …» por posición sin descuento; sobre-consumo falla cerrado por la misma regla de producción (nunca una puerta negativa). Copy neutral en la línea de 2 frentes (el pedido no lleva material). POST-as-read, sin catálogo ni storage.
2. Editor v2 (suposición 4): escribe SIEMPRE v2-shaped — el material es REQUERIDO en validate() (una escritura sin material caía al puente legacy y descartaba los descuentos tecleados en silencio: MAJOR confirmado por ambos jueces). Reemplaza al modal #1526 (eliminado con su test).
3. Sugerencias DEL SERVIDOR (§14.9.1): el editor consume GET /catalog/opening-profiles/suggestions por material — chips aplican el preset (posiciones, 40/36, fabricante SCILM, efectos, tira 70) llenando SOLO campos vacíos; el bisel italiano (profundidad − 2) llega derivado por el servidor con profile_depth_mm (refetch al teclear la profundidad, con epoch guard) — React nunca hardcodea los números de fábrica.
4. Vista previa del servidor + dibujo esquemático SVG declarativo (cotas alto/profundidad y anotación «puerta H − descuento» cuando está declarado).
5. Efectos en texto llano; cambiar italiana → aluminio quita la tira y el estado que la sigue (nada insalvable); «Quitar selección» deja la pieza FUERA de la escritura (nunca una referencia vacía que 422); miembros con rol desconocido (mig 000180) se muestran con su baja revelada y no viajan.
6. Piezas por rol (#1526): Perfil/Soportes/Tapas/Tira; espaciado de soportes exigido en el cliente (el BOM fallaba después, dentro del diseño); enteros estrictos con mensajes en español (el decimal moría en el cliente generado con error inglés).
7. Lista con columna Uso por posición y copy exacto de la issue («No se puede usar entre frentes: falta el descuento», servido por UsageAt); el EDITOR muestra el estado guardado junto a los descuentos.
8. Ficha derivada: la escritura lleva datasheet_status derivado de la envolvente declarada (alto + profundidad + descuento efectivo + origen = verificada, la regla AuthoringReady; sin democión de filas ya verificadas) — sin ella la fachada de autoría #1263 rechaza todo perfil nuevo (regresión detectada por CI: members-picker 422).
9. Fix de dominio: el puente #1530 es SIMÉTRICO — compatible_placements alimenta positions en escrituras v2-shaped.
10. §8: estilos por tokens (clases gola-editor__*, 0 px sueltos), 422 anclado a la sección que falla con role=alert + aria-describedby en descuentos y espaciado.

## Judgment-day dual (ronda 1, HEAD 46b8bbec)
- Juez A: 5 MAJOR + 9 MINOR + 1 WARNING. Juez B: 1 MAJOR + 3 MINOR + 1 WARNING.
- Confirmado por ambos (severo): escritura sin material descarta descuentos en silencio vía puente legacy → material requerido.
- Sospechosos de un solo juez corregidos en la misma ronda (decisión de alcance): sugerencias del servidor ignoradas; piezas sin remover; italiana→aluminio insalvable; huecos de aceptación de la issue (tests de validate/preview/round-trip, estado Uso con copy exacto, §8).
- MINORs: carrera del preview (epoch guard), puerta negativa (fail-closed por el motor), reveals canónicos 340.5, keys/testids de «falta» por índice, «esta C» neutral, enteros + espaciado en español, bisel con orden natural, tokens, 422 junto al campo, evidencia distinta, gofmt.
- La regresión de la ficha derivada (CI rojo) se detectó por el gate y se corrigió en esta ronda (fuera del ledger de juicio).

## Evidencia
- Backend: engine + handler tests verdes (680/684/340.5/322/324 = fixture A3, honestas «falta», sobre-consumo 422, rechazos).
- Unit UI: 38 tests de apertura (validate por material/posición/enteros/espaciado/bisel, preview server-side verbatim con índice, round-trip draft→body→row→draft con ficha derivada, Uso en lista y editor, quitar pieza, limpieza por material, disclosure rol desconocido) — suite completa 2477 ui + 286 storage verdes, typecheck limpio.
- E2E gates PASS (3/3): members-picker (fachada #1263 resuelve con la ficha derivada — el fallo de CI sanado), catálogo (en-progreso → edición completa → Verificada en la lista → readback), editor (L 680, italiana en orden natural con bisel 25.2 del servidor, estilo que usa ambos, aceptación 3 con copy exacto + evidencia). Screenshots en docs/demo/evidence/1534/ (4 capturas distintas).
- CI: pendiente en el HEAD final de la ronda 1.

## Entrega
Un PR contra main. Completo respecto del alcance (aceptación 1–4 de la issue).
