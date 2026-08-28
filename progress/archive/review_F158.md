# Review — feature F158

**Veredicto:** APPROVED

Issue #255 (QA de campo #251) · Rama `feat/255-island-elevation-sheet` ·
Commits `6b20be2` + `2e77890` (pusheados; árbol limpio, 0 commits sin push).

## Alcance revisado

- `packages/domain/src/productionElevations.ts` (+ test, index export)
- `packages/ui/src/production/ProductionIslandPreview.tsx` (nuevo)
- `packages/ui/src/production/ProductionOrderViewsPanel.tsx` (+ test),
  `production.css`, `ProductionWorkspace.tsx`,
  `hub/useProductionOrderDocuments.ts`
- `packages/excel/src/wallElevationsPdfExport.ts` (+ test nuevo)
- `apps/web/src/exportProductionPack.ts`
- `feature_list.json` (F158), `progress/current.md`

## Checkpoints

- C1: [x] Base/docs presentes. `pnpm test` 3.064 verdes (domain 1.037 ·
  ui 1.412 · excel 92 · storage 155 · web 306 · mobile 45 · desktop 17);
  `pnpm typecheck` 0 errores. Backend Go no tocado. (Deuda OC-001 conocida;
  salida real de tests/typecheck revisada.)
- C2: [x] Una feature `in_progress` (F158; se pasa a `done` en este cierre).
  Tests asociados pasan. `current.md` describe la sesión activa.
- C3: [x] Boundaries: dominio puro (sin React/fs); excel consume modelo de
  dominio y dibuja con pdf-lib; UI consume `islands` del dominio — no calcula
  geometría propia (tema/cotas desde el modelo). Sin `console.log`.
- C4: [x] Export físico con fixture test: `wallElevationsPdfExport.test.ts`
  (nuevo — el export no tenía cobertura) valida páginas vía
  `PDFDocument.load`: muro+isla+anexo=3, sólo-islas=1, sin muros ni
  islas rechaza con error explícito.
- C5: [x] Sin archivos sospechosos sin trackear. Entrada de `history.md` y
  estados de ledger se completan en este cierre.

## Diseño UI/UX (gate §8)

- D1: [x] Sólo tokens: CSS nuevo usa `var(--space-*)`, `var(--text-*)`,
  `var(--surface-muted)`, `var(--border-default)`, `var(--radius-md)`;
  fills del SVG vienen de `getCategoryTheme('isla')` (variables con
  fallback, mismo lenguaje que la planta). `fontSize` numérico de atributo
  SVG sigue el precedente de `ProductionElevationPreview`/plan slide.
- D2: [x] Patrón correcto: sección "Islas (libres)" hermana de "Elevaciones
  por muro" (h4 + hint + lista), ficha SVG reutiliza la estructura visual
  de `prod-elev-preview`. La ficha es el artefacto de reemplazo que pide el
  issue (no se mezcla con muros).
- D3: [x] N/A — no se agregan modales.
- D4: [x] N/A — no se agregan toasts.
- D5: [x] N/A — no se agregan iconos.
- D6: [x] N/A — sin animaciones nuevas.
- D7: [x] Gate §8: estados (la sección sólo existe con islas; placeholder de
  muros intacto); sin controles nuevos (sólo title/disabled del botón
  existente); a11y del SVG con `role="img"` + aria-label descriptivo con
  medidas; responsive vía `max-width: 100%`. Screenshot review justificado
  como en F157: componente nuevo pero construido 1:1 sobre patrones visados
  (elev-preview + tema isla de la planta); sin seed multi-ambiente/isla para
  smoke browser; re-verificación por canal QA #251.
- D8: [x] Copy §7: español de taller, sentence case, medidas formateadas
  (mm, ×), sin internals. Pluralización intacta.

## Hallazgo de review (corregido en el ciclo)

`ProductionWorkspace` gating `elevationsAvailable` sólo por `walls.length`:
la fila "Elevaciones" de Documentos quedaba indisponible para obras
sólo-islas, inconsistente con el botón de Vistas y el pack. Corregido en
`2e77890` (gating muros+islas; label "Elevaciones e islas (PDF)"). Suite
re-corrida verde tras el fix.

## Tests de aceptación (#255)

- [x] Planta con isla dibujada en su posición: preexistente (categoría
  'isla' con tests en presentationSlides); flujo Vistas cubierto por el
  test multi-ambiente de F157 que incluye isla free (it-d).
- [x] Ficha dibujada por isla: sección `prod-vistas-islands` +
  `prod-island-sheet-*` con código, medidas y posición (test panel).
- [x] PDF: hoja por isla (1 muro+1 isla+anexo=3 páginas; sólo-islas=1);
  anexo text-only queda sólo para sin colocar.
- [x] Export habilitado para obras sólo-islas (botón Vistas, Documentos y
  pack); sin muros ni islas sigue deshabilitado con razón explícita.
- [x] Muros siguen sin inventar alzado para free (wall elevations filtran
  mode wall; test dominio existente + islands separados).
