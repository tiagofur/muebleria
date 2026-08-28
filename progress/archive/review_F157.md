# Review — feature F157

**Veredicto:** APPROVED

Issue #256 (bug QA de campo #251) · Rama `fix/256-prod-views-multi-space` ·
Commit `e840876` (pusheado; 0 commits locales sin push).

## Alcance revisado

- `packages/ui/src/production/ProductionOrderViewsPanel.tsx` (+ tests)
- `packages/ui/src/production/production.css`
- `feature_list.json` (F157), `progress/current.md`

## Checkpoints

- C1: [x] Archivos base y docs presentes. TS surface verificada directo:
  `pnpm test` 3.057 verdes (domain 1035 · ui 1410 · excel 89 · storage 155 ·
  web 306 · mobile 45 · desktop 17), `pnpm typecheck` 0 errores. Backend Go
  no tocado por el diff. (Deuda OC-001 de `init.sh` documentada; salida real
  de install/tests revisada, no sólo exit code.)
- C2: [x] Una sola feature `in_progress` (F157, se pasa a `done` en este
  cierre). Tests asociados pasan. `current.md` describe la sesión activa.
- C3: [x] Boundaries respetados: `packages/domain` intacto (sólo consumido);
  la UI no calcula dominio — el scoping por ambiente delega en
  `listProductionSpaceOptions` / `projectScopedToProductionSpace` /
  `unplacedItemIdsForProduction` (productionScope.ts, PROD-4.4). Sin
  `console.log`, sin fs, sin fórmulas de costo en UI.
- C4: [x] La feature no toca export/storage/motor de golden. Verificación de
  comportamiento (no source-grep): tests jsdom del panel ejercen el pipeline
  real (dominio + `resolveProject3DPreview` contra fixtures de 2 ambientes).
- C5: [x] Árbol limpio, sin archivos sin trackear sospechosos. Entrada en
  `history.md` y estados de ledger se completan en este cierre.

## Diseño UI/UX (gate §8)

- D1: [x] Sólo tokens: CSS nuevo usa `var(--space-6)`; 0 hex/px/font-size
  literales.
- D2: [x] Patrón correcto: tabs compartidas `WorkspaceTabs` (F109, sin tabs
  locales nuevas) + tabpanel controlado por el padre — mismo patrón que
  `ProjectPresentationMode` para ambientes. Secciones y esqueleto intactos.
- D3: [x] N/A — no se agregan modales.
- D4: [x] N/A — no se agregan toasts.
- D5: [x] N/A — no se agregan iconos.
- D6: [x] N/A — no se agregan animaciones; las tabs no tienen motion propio.
- D7: [x] Gate §8 recorrido:
  - Estados de pantalla: los empty por ambiente ya existen (planta: "Este
    ambiente aún no tiene muros ni muebles"; 3D: mensaje existente);
    loading/error N/A (panel síncrono, sin nuevos estados async).
  - Estados de control: el único control nuevo es la tab bar compartida
    (hover/focus-visible/active del sistema, roving tabindex verificado en
    uso existente).
  - Primaria única: sin cambios de acciones.
  - A11y: tablist/tab/tabpanel wired (id ↔ aria-labelledby asserteado en
    test); labels de texto (no icon-only); teclado vía roving tablist.
  - Responsive smoke / screenshot review: **justificado explícitamente** —
    el delta visual se reduce al componente compartido `WorkspaceTabs`
    (overflow propio vía `.tabs__scroller`, ya validado en el resto del app
    post-F109) y a hints de texto; el contenido por ambiente es dato, cubierto
    por tests de comportamiento contra el pipeline real. No existe seed
    multi-ambiente para smoke browser sin armar la obra a mano en Proyectar.
    Re-verificación visual en taller vía el canal QA que originó el bug
    (#251/#256).
- D8: [x] Copy §7: español de taller, sentence case, pluralización correcta
  (unidad/unidades, colocada/colocadas), sin internals de sistema. §4.8: sin
  significado sólo por color; counts con pluralización en texto.

## Nota de diseño (no bloqueante)

El tabpanel envuelve las tres secciones (Planta, Elevaciones, 3D) aunque las
elevaciones no cambian con la tab — consistente con el precedente de
`ProjectPresentationMode` (su tabpanel envuelve todos los slides, incluyendo
los que no varían por ambiente). Las elevaciones quedan deliberadamente fuera
del scope: el QA #256 las dio por aceptables (por ambiente, con prefijos), y el
filtro de ambiente del hub (PROD-4.4) ya las acota cuando aplica.

## Tests de aceptación (#256)

- [x] Scope un ambiente: mono-ambiente sin tabs, planta sin control, hint sin
  nombre de espacio, sin hint de unplaced.
- [x] Scope "Toda la obra" + multi-ambiente: tabs controlan planta (controlada)
  y 3D per-espacio; muros/módulos sólo del ambiente seleccionado (isla free
  incluida); sin cola lineal de otros espacios (assert explícito de ausencia
  del otro ambiente y de "sin colocar al final").
- [x] Ítems sin colocar en ninguna planta → hint con conteo, no cola fantasma.
- [x] Cambio de tab re-scoping planta + 3D.
- [x] Tabpanel wired a la tab activa (id/aria-labelledby).
