# Review — feature F140

**Veredicto:** CHANGES_REQUESTED

Commit bajo review: `6577c96` (rama `feat/f140-operational-core-ux`, pushed).
`./init.sh` verde completo (typecheck + tests TS + go test). Paridad
`contracts/siteSurvey.json` afirmada en ambos lados con tests espejo.

## Checkpoints

- C1: [x] harness completo; init.sh exit 0.
- C2: [x] una feature in_progress (F140); tests asociados verdes; current.md
  describe la sesión.
- C3: [ ] dos hallazgos (R1 sync online, R2 ciclo de imports runtime — ver abajo).
  Resto bien: domain sin deps externas; UI consume derivaciones del domain sin
  calcular fórmulas; errores ValidationError (DomainError); sin console.log.
- C4: [x] domain/storage/ui verdes; round-trip mappers con fixture; sin export
  físico tocado.
- C5: [ ] pendiente al cierre (history/current/ledger se actualizan tras
  aprobar — flujo normal).

## Diseño UI/UX

- D1: [x] tokens only en `siteSurvey.css`, `projectOverview.css`,
  `ops-exceptions__*` (dashboard.css). Sin hex ni px sueltos nuevos.
- D2: [x] paneles como tabs de herramientas del workspace de obra (§6.2);
  overview sigue el patrón lista→detalle; nav simplificado como superficie
  reducida sobre APP_NAV_SECTIONS.
- D3: [x] sin modales nuevos.
- D4: [x] toasts del shell existentes (runSurveyAction reutiliza el patrón).
- D5: [ ] iconos nuevos sin `strokeWidth={1.5}` explícito en
  `SiteSurveyPanel.tsx` y `ProjectOverviewPanel.tsx` (§3.7).
- D6: [x] sin animaciones nuevas (transiciones del sistema en css).
- D7: [x] DoD §8: estados empty/ready/blockers, una primaria por contexto,
  gates disabled con explicación (`title` con el blocker).
- D8: [ ] `SiteSurveyPanel` empty state usa markup propio en vez del
  componente `EmptyState` (§4.5 «prohibidos empty states propios»).

## Cambios requeridos

1. **R1 — Bug de sincronización online (apps/web/src/AppContent.tsx,
   `runSurveyAction`)**: tras una acción API exitosa se aplica
   `local.project`, cuyo survey lleva IDs generados en TS, mientras el server
   persistió otro survey con sus propios IDs. La siguiente acción online
   (p. ej. capturar el espacio recién creado) envía un `spaceId` que no
   existe en el server → 400 «espacio inexistente». Aplicar el survey que
   devuelve la vista del server (`SiteSurveyView.survey`) sobre el proyecto
   local cuando la acción fue por API; el payload local queda sólo para el
   modo offline/local.
2. **R2 — Ciclo de imports runtime `projectLifecycle` ↔ `siteSurvey`
   (packages/domain/src)**: `siteSurvey.ts` importa
   `createProjectEvent`/`appendProjectEvent` de `projectLifecycle.ts`, y
   `projectLifecycle.ts` importa `surveyFabricationBlockers` de
   `siteSurvey.ts` (líneas 11-12). Hoy lo tolera ESM por hoisting, pero es
   frágil para bundlers/herramientas futuras. Extraer el gate puro
   (`surveyFabricationBlockers`, `isSurveyApprovedForFabrication`,
   `SurveyGateBlocker`) a un módulo hoja (p. ej. `siteSurveyGate.ts`) que
   ambos importen; mantener los re-exports desde `siteSurvey.ts`/`index.ts`
   para no romper consumidores.
3. **R3 — Menores de craft UI**: `strokeWidth={1.5}` en los iconos Lucide
   nuevos de `SiteSurveyPanel.tsx` y `ProjectOverviewPanel.tsx` (§3.7); usar
   el componente `EmptyState` en el empty del levantamiento (§4.5).

Notas (no bloqueantes):
- `applyCostingProject` reutilizado como "aplicar proyecto con sub-entidad
  server-authoritative" para survey: funciona pero el nombre confunde;
  considerar renombrar genérico en una feature futura de limpieza.
- El evento de lifecycle server-side no aparece en el timeline local hasta
  refresh tras acciones API de survey (mismo comportamiento que costing);
  aceptable, no inventar eventos locales duplicados.
