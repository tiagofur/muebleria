# Review — feature F159

**Veredicto:** APPROVED

Issue #254 (reabierto por decisión del dueño; origen QA #251) · Rama
`feat/254-elevations-grouped-by-space` · Commit `73d5471` (pusheado; árbol
limpio, 0 commits sin push).

## Alcance revisado

- `packages/domain/src/productionElevations.ts` (+ test, index exports)
- `packages/ui/src/production/ProductionOrderViewsPanel.tsx` (+ test),
  `ProductionIslandPreview.tsx`, `production.css`
- `packages/excel/src/wallElevationsPdfExport.ts` (+ test)
- `feature_list.json` (F159), `progress/current.md`

## Checkpoints

- C1: [x] `pnpm test` 3.069 verdes (domain 1.039 · ui 1.414 · excel 93 ·
  storage 155 · web 306 · mobile 45 · desktop 17); `pnpm typecheck` 0
  errores. Backend Go no tocado. (Deuda OC-001 conocida; salida real
  revisada.)
- C2: [x] Una feature `in_progress` (F159; se pasa a `done` en este cierre).
  Tests asociados pasan. `current.md` describe la sesión.
- C3: [x] Boundaries: el agrupado vive en dominio puro
  (`groupProductionElevationsBySpace`); UI y excel consumen grupos, no
  calculan pertenencia de espacio. `wallName` crudo evita parsing de
  prefijos en consumidores. Sin `console.log`.
- C4: [x] Export físico: test existente ampliado (multi-ambiente: grupo
  Cocina muro+isla → grupo Baño muro → anexo = 4 páginas vía
  `PDFDocument.load`). El ORDEN por grupos queda garantizado por el test de
  dominio del helper (documentado en el test del PDF).
- C5: [x] Sin archivos sospechosos. Entrada de `history.md` y ledger al
  cierre.

## Diseño UI/UX (gate §8)

- D1: [x] Sólo tokens: `.prod-vistas__elev-groups/-group` con
  `var(--space-6/-3)`; `.prod-vistas__group-title` con `var(--text-md)`,
  `var(--weight-semibold)`, `var(--text-primary)`. 0 hex/px literales.
- D2: [x] Patrón correcto: jerarquía de headings sin saltos (h3 PageHeader →
  h4 secciones → h5 ambiente). Grupos con heading estructuran el listado que
  pedía #254 ("no un listado plano confuso"). Mono-ambiente sin headings
  extra (cero ruido en el caso común).
- D3: [x] N/A — no se agregan modales.
- D4: [x] N/A — no se agregan toasts.
- D5: [x] N/A — no se agregan iconos.
- D6: [x] N/A — sin animaciones nuevas.
- D7: [x] Gate §8: sin controles nuevos; estados intactos (placeholder muros,
  sección islas condicional); a11y por headings + testids; responsive por
  flex/gap (contenedores tokenizados). Screenshot review justificado igual
  que F157/F158: delta = headings y agrupación sobre componentes ya visados;
  comportamiento cubierto por tests jsdom; re-verificación por canal QA #251.
- D8: [x] Copy: headings = nombre de ambiente (dato del usuario); PDF
  "Ambiente: X" sólo multi-ambiente (mono sin ruido). Sin internals.

## Notas (no bloqueantes)

1. La ficha de isla en modo agrupado omite el ambiente (`showSpace=false`)
   porque el heading del grupo ya lo nombra; en mono y en el PDF la ficha lo
   conserva (página impresa es standalone). Decisión consistente con el
   patrón "el contexto más cercano nombra el ambiente".
2. Cobertura menor: el suffix de ambiente en ficha mono no tiene assertion
   directa (sí la tiene la ausencia en modo agrupado y la presencia del
   heading). Aceptable para el tamaño del cambio.

## Tests de aceptación (#254)

- [x] OP con 2 ambientes → Vistas muestra grupos por ambiente con heading
  (h5 "Cocina"/"Baño"), no listado plano (test panel).
- [x] PDF: muros e islas de cada ambiente juntos (orden por
  `groupProductionElevationsBySpace`, test dominio; conteo de páginas
  multi-ambiente en test excel); línea "Ambiente" en páginas de muro.
- [x] Scope "Toda la obra" vs un ambiente: coherente (filtro hub PROD-4.4
  intacto; el agrupado sólo aplica multi-ambiente).
- [x] Mono-ambiente: sin headings de grupo ni contenedores agrupados; PDF sin
  línea Ambiente (test panel + rama mono del dominio).
- [x] Tests domain/UI del agrupado + suite + typecheck verdes.
