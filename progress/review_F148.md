# Review — feature F148

**Veredicto:** APPROVED

**Fecha:** 2026-08-23 · **Rama:** `feat/f148-usability-benchmark` (2 commits, pushed)

## Checkpoints

- C1: [x] Archivos base y docs/skills presentes; `./init.sh` exit 0 al inicio
  de la sesión; suites TS + Go verdes.
- C2: [x] Una sola feature `in_progress` (F148); tests de features `done`
  pasan (3019 TS verdes); `progress/current.md` describe la sesión activa.
- C3: [x] Boundaries respetados: `usabilityBenchmark.ts` vive en
  `packages/ui` con APIs de DOM/storage (sin React en el módulo de telemetría,
  sin fs, sin fórmulas de dominio); el panel es presentación pura; las
  costuras del studio sólo llaman `trackUsability` (no calculan dominio); smoke
  en `tests/smoke/`. Sin `console.log` nuevos. Sin errores de dominio nuevos.
- C4: [x] Verificación real: 3019 tests TS verdes (29 nuevos: 22 módulo +
  panel + summarizer); typecheck 0 errores; smoke de usabilidad verde con
  navegador real/WebGL; no toca export/storage → sin golden adicional.
- C5: [x] Sin archivos sospechosos sin trackear; `feature_list.json` F148 con
  estado correcto al cierre; history/current actualizados al final.

## Diseño UI/UX (panel del facilitador)

- D1: [x] Sólo tokens (`usabilityBenchmarkPanel.css`: `--surface-*`,
  `--border-*`, `--radius-lg`, `--shadow-lg`, `--space-*`, `--text-*`,
  `--weight-*`, `--z-modal-dialog`); 0 hex; anchos de contenedor en rem
  (convención §4.3 para superficies fijas).
- D2: [x] Overlay flotante del facilitador (no es pantalla del producto; se
  monta sólo con flag, patrón OnboardingTourModal/seed perf).
- D3: [x] N/A modal — no usa `<Modal>`; es `aside` complementario con
  colapso a pill (`aria-expanded`); no interrumpe foco del participante.
- D4: [x] N/A toasts — feedback transient inline con `aria-live` (status).
- D5: [x] Sólo iconos Lucide con `strokeWidth={1.5}` (Activity, CheckCircle2,
  ClipboardCopy, Download, X); filas nuevas agregadas a design.md §3.7.
- D6: [x] N/A motion — el panel no introduce animaciones.
- D7: [x] Gate §8: estados de control vía `.btn` global (hover/focus-visible/
  active); UNA primaria por estado del panel (Iniciar sesión / Completada /
  Nueva sesión); icon-only (X) con `aria-label`; `role="complementary"` +
  `aria-label`; screenshots de evidencia en test-results/.
- D8: [x] Copy taller sentence case («Iniciar sesión», «+ Ayuda»); la UI no
  muestra internos (participant → reporte anónimo P#); contraste por tokens
  AA existentes.

## Puntos revisados en detalle

1. **Costo cero sin flag/sesión** (North Star §17-18): `trackUsability`
   early-return sin sesión; panel no montado sin flag; listener de clicks
   sólo con sesión activa; `smoke:perf` corre SIN el flag del benchmark.
2. **Data truth**: sesión proxy etiquetada `source:"proxy"`; protocolo y smoke
   documentan que los tiempos proxy no son evidencia de usuario; targets con
   `metRatio` sin inventar métricas.
3. **Persistencia D4**: localStorage por mutación; restauración tras recarga
   re-adhiere captura de clicks (bug encontrado en review propia y corregido
   con test: commit `fix(usability): re-adherir captura de clicks…`).
4. **Regresión permanente**: el smoke recorre el script canónico con la UI
   real (HTML5 dnd sintético reutilizando los handlers reales de la app) y
   exige eventos por tarea — si una feature rompe un paso de #314, falla.
5. **Scope**: diff 100% F148; el wrapper de `setShowPresentation` es la única
   puerta de presentación (instrumentación, no cambio de comportamiento).

## Excepción registrada (entorno, resuelta en retry)

`pnpm smoke:perf` (G2 drag p95 < 250 ms) falló durante la sesión con load
average 11+ del software del usuario (WindowServer/ZCode/Defender): **falla
idéntica en `main`** (328.4 ms vs 257–324 ms en la rama), mejorando
monotónicamente al bajar la carga. En el retry final con load ~5.8 el smoke
completo pasó verde — confirmado como condición de máquina, no regresión de
F148. El baseline de F147 (p95 146 ms) fue medido en máquina ociosa; correr
smoke:perf con load alto produce falsos negativos (nota para sesiones
futuras).
