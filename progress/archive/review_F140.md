# Review — feature F140

**Veredicto:** APPROVED

Commit bajo review: `6577c96` + fix commit de deuda de review (rama
`feat/f140-operational-ux`, pushed). `./init.sh` verde completo tras los
fixes: typecheck + 2761 tests TS (domain 941, ui 1215, storage 153, web 301,
excel 89, mobile 45, desktop 17) + go test. Paridad `contracts/siteSurvey.json`
afirmada en ambos lados con tests espejo.

## Checkpoints

- C1: [x] harness completo; init.sh exit 0.
- C2: [x] una feature in_progress (F140); tests asociados verdes; current.md
  describe la sesión.
- C3: [x] R1/R2 resueltos en el fix commit (ver abajo). domain sin deps
  externas; UI consume derivaciones del domain sin calcular fórmulas; errores
  ValidationError (DomainError); sin console.log.
- C4: [x] domain/storage/ui verdes; round-trip mappers con fixture; sin export
  físico tocado.
- C5: [x] cierre aplicado tras esta aprobación (ledger/history/current/push).

## Diseño UI/UX

- D1: [x] tokens only en `siteSurvey.css`, `projectOverview.css`,
  `ops-exceptions__*` (dashboard.css). Sin hex ni px sueltos nuevos.
- D2: [x] paneles como tabs de herramientas del workspace de obra (§6.2);
  overview sigue el patrón lista→detalle; nav simplificado como superficie
  reducida sobre APP_NAV_SECTIONS.
- D3: [x] sin modales nuevos.
- D4: [x] toasts del shell existentes (runSurveyAction reutiliza el patrón).
- D5: [x] `strokeWidth={1.5}` en los iconos Lucide nuevos (fix R3).
- D6: [x] sin animaciones nuevas (transiciones del sistema en css).
- D7: [x] DoD §8: estados empty/ready/blockers, una primaria por contexto,
  gates disabled con explicación (`title` con el blocker).
- D8: [x] `EmptyState` component en el empty del levantamiento (fix R3);
  copy taller + sentence case; medidas con mm formateados; `—` en ausentes.

## Cambios requeridos (resueltos en el fix commit)

1. **R1 — Bug de sincronización online** ✔ `runSurveyAction` aplica ahora el
   survey que devuelve la vista del server (`view.survey`) tras cada acción
   API; el payload local queda sólo para el modo offline.
2. **R2 — Ciclo de imports runtime** ✔ gate extraído a
   `packages/domain/src/siteSurveyGate.ts` (módulo hoja, imports de tipos
   solamente); `projectLifecycle` y `siteSurvey` dependen de él sin ciclo;
   re-exports preservados para consumidores.
3. **R3 — Craft UI** ✔ `strokeWidth={1.5}` en iconos nuevos de
   SiteSurveyPanel/ProjectOverviewPanel; `EmptyState` en el empty.

Notas (no bloqueantes, para features futuras):
- `applyCostingProject` reutilizado como "aplicar proyecto con sub-entidad
  server-authoritative" para survey: funciona pero el nombre confunde;
  considerar renombrar genérico en una limpieza futura.
- El evento de lifecycle server-side no aparece en el timeline local hasta
  refresh tras acciones API de survey (mismo comportamiento que costing);
  aceptable, no inventar eventos locales duplicados.

