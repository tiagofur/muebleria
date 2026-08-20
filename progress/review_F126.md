# Review — feature F126 (`cut_strategy_ui_export_dispatch`)

**Veredicto:** CHANGES_REQUESTED (1 cambio puntual; el resto pasa completo)

Commit revisado: `f609bcf` (main). Verificación ejecutada por el revisor:
`pnpm test` → 2338/2338 verdes (domain 666, storage 126, excel 79, ui 1129,
mobile 36, desktop 17, web 285) · `pnpm typecheck` → 7 workspaces OK ·
working tree limpio (sin untracked sospechosos).

## Checkpoints

- C1: [x] Harness completo; `pnpm test` exit 0 (equivalente al gate de init)
- C2: [x] Una sola feature `in_progress` (F126); `progress/current.md` describe la sesión activa
- C3: [x] Boundaries respetados: el panel importa solo `@muebles/domain` + react + componente local; arma el objeto `CutPlanConfig` y despacha `optimizeCutPlan` (función de dominio) — la UI no calcula. `apps/web/src/exportCutPlanDxf.ts` es adaptador delgado (serializa vía `@muebles/excel` + descarga). Sin `console.*` nuevo.
- C4: [x] Tests al nivel correcto: panel (6 tests F126 — swap de inputs por modo, exclusividad de exports en ambos modos, calls DXF con variante, secuencia condicional); el contenido del DXF ya tiene fixture/units en `packages/excel` (F125, revisada aparte). `pnpm --filter @muebles/domain test` verde.
- C5: [x] Sin archivos sin trackear; feature `in_progress` hasta cierre. **Pendiente de cierre: `git push`** — `origin/main..HEAD` = `f609bcf` (acordado: push al cierre de la serie; no bloquea este veredicto, pero no cerrar la serie sin push).

## Aceptación de F126

1. [x] Selector «Tipo de corte» (Sierra | CNC Nesting) con `aria-pressed`; `handleGenerateCutPlan` envía `cutStrategy` + `toolSpacingMm` (condicional a nesting) a `optimizeCutPlan`.
2. [x] Config adaptativa: nesting muestra «Espaciado fresa (mm)» y oculta «Disco / Kerf (mm)» (test lo cubre); refilados, veta y deducción de canto comunes. Coherente con el dominio (`optimizer/nesting.ts` usa `toolSpacingMm`; kerf es de sierra).
3. [x] Export exclusivo: ternario sobre `planStrategy`; tests afirman que en sierra no existe ningún botón DXF y en nesting no existen PDF/XLSX.
4. [x] La card placeholder «CNC Nesting / G-Code — Próximamente» fue eliminada y reemplazada por la card DXF real (dos variantes).
5. [x] Wiring completo: `EngineeringWorkspace` (prop `onExportOptimizer` preexistente + `onExportCutPlanDxf` nueva) → `ShellView` → `AppContent` → `useExportHandlers.handleExportCutPlanDxf` → `exportCutPlanDxf.ts` → `dxfCutPlanExport` (`@muebles/excel`). MIME `application/dxf` en el helper genérico de descarga (que ya despachaba pdf/zip).
6. [x] Tokens: lo nuevo usa `var(--surface-card/--border-default/--radius-md/--text-muted)` para color/radio; los px inline de dimensiones replican el patrón preexistente del archivo (no introducido por F126). Ver bloque Diseño para el detalle y las observaciones.
7. [x] `pnpm test` (2338) + `pnpm typecheck` (7 workspaces) verdes — reverificados por el revisor.

## Punto crítico: export sigue al PLAN generado, no al selector vivo

Verificado. `planStrategy = currentCutPlan?.config.cutStrategy ?? cutStrategy`
(`ProductionOrderOptimizationPanel.tsx:161`); el área de export y los handlers
PDF/DXF usan `currentCutPlan` (el mismo objeto que renderiza
`ProductionBoardView`), así que no existe camino donde el archivo descargado
no corresponda al layout en pantalla. Si el usuario cambia el selector sin
regenerar, los exports permanecen fieles al plan visible. El fallback a
`cutStrategy` solo aplica sin plan, donde PDF/DXF quedan `disabled`
(`!currentCutPlan`); el Optimizer XLSX es rows-based (independiente del plan).
Secuencia de cortes condicional alineada con el dominio: `nesting.ts:235`
produce `instructions: []` → sidebar `1fr 300px` → `1fr`.

## Diseño UI/UX (docs/design.md §8)

- D1: [x] Color/radio/borde solo con variables CSS en lo nuevo (sin hex nuevo; `#16a34a` y el fallback `#3b82f6` de `--accent-primary` son preexistentes sin tocar — nota al pie). Inline px de padding/width = patrón preexistente del archivo.
- D2: [x] Patrón de pantalla intacto (tab Optimización del workspace Ingeniería); la card DXF replica la anatomía de las cards de export existentes; selector sigue el patrón toggle del selector de tableros preexistente.
- D3: [x] N/A modales (no se agregan overlays).
- D4: [x] Toasts via handler del shell: `✓ {archivo} descargado` (success, §4.4); error con `err.message`/fallback — espejo exacto del handler PDF existente.
- D5: [~] Iconografía: la card XLSX nueva agrega un emoji (📊, línea 614) siguiendo el patrón preexistente de emojis del panel (📄 ⚡ ⚙). No-Lucide es deuda de toda la sección de exports, no de F126 — ver Observación 2.
- D6: [x] Sin animaciones nuevas; reduced-motion N/A para lo agregado.
- D7: [ ] **Gate §8 — ítem Copy falla por typo en copy nueva de usuario** (ver Cambios requeridos 1).
- D8: [x] A11y: toggles con `aria-pressed` + `role="group"` + `aria-label`; botones con texto (no icon-only); estados disabled explícitos (`exportBusy`, `!currentCutPlan`, `!onExportCutPlanDxf`). Matriz de estados de los controles nuevos heredada de las clases del sistema (`.btn`, `.btn--primary`, `.btn--ghost`, `.btn--small`) — aceptable vía clases del sistema.

Una primaria por contexto y modo: [x] sierra → «Descargar PDF de Taller» primary + «Descargar Optimizer XLSX» base; nesting → «Descargar DXF (tableros)» primary + «(piezas)» base. El toggle usa `btn--primary` como estado seleccionado (mismo patrón preexistente del selector de tableros; selección ≠ CTA — ver Observación 3).

## Cambios requeridos

1. **Typo en copy visible de usuario** — `packages/ui/src/production/ProductionOrderOptimizationPanel.tsx:540`: «Geometría DXF R12 del plan **nesteadO**: contornos…» → debe decir «**nesteado**». Es copy nueva introducida por F126; §7 («el copy es UI») y el gate §8 (ítem Copy) la cubren. Fix de 1 palabra +, si querés, assert opcional en el test existente.

## Observaciones (NO bloqueantes)

1. Deuda preexistente sin tocar por F126 (no mezclar en el fix del typo): `--accent-primary` no existe en `tokens.css` (el fallback hex `#3b82f6` de la línea 370 es el color efectivo) y `#16a34a` hardcodeado en el mensaje de guardado (línea 349) — deberían migrar a `--accent-500`/`--success-700` en una limpieza del panel.
2. Emojis como icono (📄 ⚡ ⚙ 📊 💾) en las cards de export y botones del panel: §3.7 manda Lucide `strokeWidth={1.5}`. F126 mantuvo consistencia con los siblings (correcto a corto plazo); queda como tarea de polish del panel completo para no mezclar features.
3. Toggles (tipo de corte, selector de tableros) expresan selección con `btn--primary`; §3.6.1 prefiere fondo tonal de la rampa para selected persistente. Patrón preexistente del archivo; registrar para una pasada de unificación de toggles.
4. `btn--secondary` (línea 339, «Guardar Plan») no existe en el sistema BEM (§5.1: la secundaria es `.btn` base). Preexistente; la clase inexistente hoy resuelve como `.btn` base, por lo que no hay regresión visual.
5. Cierre de serie: `git push` pendiente (`origin/main..HEAD` = `f609bcf`) — según acuerdo, no bloquea; no cerrar la serie sin él.

## Nota de proceso

El veredicto es CHANGES_REQUESTED **únicamente** por el ítem 1 (typo). Todo lo
demás — arquitectura, boundaries, tests, typecheck, exclusividad de export,
fidelidad plan↔archivo, primarias por modo, a11y de los controles nuevos —
pasa. Tras aplicar el fix (y sus tests siguiendo verdes), la re-review es
inmediata; el resto del bloque queda aprobado como está.
