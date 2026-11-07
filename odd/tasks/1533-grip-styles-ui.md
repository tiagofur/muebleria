# #1533 — Ajustes › Agarres: estilos de agarre del taller (web)

Lane: Delegated Direct (backend acotado + web + e2e). Writer: esta sesión (worktree `1533-agarres-ui`, rama `feat/1533-grip-styles-ui`, base origin/main ad2c4d3b).
Prerrequisito UX: brief publicado y aprobado por el owner (comentario en la issue, 2026-11-07); suposiciones 1–5 honradas.

## Alcance ejecutado
1. Preview server-side (suposición 2): engine.GripStylePreviewSentence resuelve «Mueble de 720 → puerta de 680» con el contrato A3 (#1529); gola con between → columna canónica de 2 frentes ((720−40−36)/2); rebase declara la extensión (nunca una altura inventada contra la holgura del taller); handle sin descuento. Endpoint POST /api/catalog/grip-styles/preview (POST-as-read, patrón del repo): el servidor une los IDs del editor con el catálogo vía la regla de uso #1530 y falla cerrado. Códigos de error unificados bajo GRIP_SNAPSHOT_INVALID (código ya registrado; mensajes específicos).
2. Tab «Agarres» en Ajustes (suposición 1) con GripStylesSection: lista de tarjetas (resumen por tipo, insignia Predeterminado única, switch «Ofrecer en SketchUp» deshabilitado + explicación para el predeterminado), editor modal (fila por tipo: jaladera con picker de herraje, gola con perfiles utilizables por posición vía `usage`, rebase con 20 por defecto), vista previa del servidor renderizada verbatim con re-resolución en cambios discretos (no en cada tecla), estados loading/error/retry/saving/412-banner «Recargá y volvé a aplicar»/422 role=alert/vacío. Aviso de #1531 retirado del tab «diseño».
3. Ficha del mueble (suposición 3): la procedencia lee GET /projects/{id}/grip (#1532) — Estilo gobernante (+ «Excepción sobre …» cuando rige una override) + valores congelados; reemplaza la procedencia #1330 (openingProvenanceView retirada, spec 1263 actualizado al nuevo testid pf-detail-grip-lines).
4. snapshot:null se omite del payload (omitempty) — el esquema lo exige objeto y sin estilo aplicado no viaja; la excepción gobierna.

## Evidencia
- go build/vet + suite sin DB verde; suite storage sin cambios relevantes; drift OpenAPI current; ci_extension_version PASS 0.1.107.
- Unit UI: GripStylesSection.test.tsx (resúmenes por tipo, badge único, round-trip create/update con versión If-Match, 412-banner, validación nombre, estados vacío/error/carga) — 214 archivos / 2461 tests verdes.
- Backend tests: engine sentence (680 exacto, 322 columna, rebase, rechazos) + handler (une catálogo, falla cerrado perfil desconocido/no utilizable).
- E2E gates (org real): settings-grip-styles.spec.ts PASS (crear Gola negra L+C/rebase, predeterminado único, preview «Mueble de 720 → puerta de 680» + «322», aviso retirado, un-offer no toca proyectos, ficha congelada «Estilo: Gola negra» sin excepción) y opening-bom-quote.spec.ts PASS (regresión 1263 con el nuevo testid).
- Visual Evidence: docs/demo/evidence/1533/{agarres-list-default,agarres-editor-preview,mueble-grip-provenance}.png.
- Paridad de códigos (#1251-like gate): códigos del preview unificados a GRIP_SNAPSHOT_INVALID (TestEngineContractIssueCodesAreRegistered verde).

## Entrega
Un PR contra main con los commits por unidad de trabajo. Completo respecto del alcance de la issue (ítems 1–5 del alcance; aceptación 1–4 demostradas).

## Cierre de la ronda de fixes (2026-11-07)

- CI del PR: los webhooks de Actions dejaron de dispararse para la rama
  (sin corrida para dos pushes); diagnosticado con workflow_dispatch (vive)
  y el PR cerrado/reabierto sin efecto. Integrado main (#1556, b9fe7282)
  por merge (conflicto único: types.ts regenerado — resuelto con
  generate_openapi.py, drift current). CI disparado por dispatch sobre el
  HEAD de merge 112363a1: corrida autoritativa 42395098778 SUCCESS 22/22;
  la corrida duplicada cancelada dejó check-runs rojos huérfanos —
  rerun --failed sobrescribió (22 pass). Base del bundle: b9fe7282.
- Spec 1531 actualizado: afirmaba el aviso que #1533 reemplaza; ahora
  verifica el tab Agarres real (gate PASS).
- Regresión C1-like de esta issue: el snapshot null del agarre del proyecto
  se omite del payload (el esquema lo exige objeto; sin estilo no viaja) —
  cazado por el gate 1263 con la ficha nueva.
