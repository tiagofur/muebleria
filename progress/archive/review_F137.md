# Review — feature F137 (operational_core_o4, Issue #303, OC-070..OC-074)

**Fecha:** 2026-08-21 · **Rama:** `feat/f137-installation-closeout` (commit `a1b4926`, 1 commit)
**Veredicto:** CHANGES_REQUESTED (sólo defects menores de copy/formato UI + un accidente de formato; arquitectura, dominio, backend y verificación: correctos)

## Verificación ejecutada por el revisor (no heredada)

- `pnpm test` monorepo: **verde** — domain 836 · storage 143 · excel 89 · ui 1169 · mobile 45 · desktop 17 · web 301.
- `pnpm typecheck`: **verde** (7 paquetes).
- `cd backend-go && go test ./...`: **verde** (todos los paquetes ok).
- `git status`: limpio · `git log origin/feat/f137-installation-closeout..HEAD`: **vacío** (todo pushed).
- Diff revisado archivo por archivo (`git show HEAD`) contra `docs/architecture.md`, `docs/conventions.md`, `CHECKPOINTS.md`, `docs/verification.md`, `docs/design.md`, `docs/operational-ux.md`.

## Checkpoints

- C1: [x] Harness completo (AGENTS.md, init.sh, feature_list.json, progress/current.md, CHECKPOINTS.md, 3 skills, docs canónicos). Nota pre-existente no bloqueante: `CHECKPOINTS.md` refiere `docs/prd.md`, que hoy es `docs/prd-v2.md` (divergencia ya registrada en AGENTS.md/doc-sync, no introducida por F137). Los gates de `init.sh` (typecheck+tests TS+go) se ejecutaron directamente y en verde.
- C2: [x] Exactamente 1 feature `in_progress` (F137); `progress/current.md` describe la sesión activa con evidencia real; suite global verde.
- C3: [x] Arquitectura respetada:
  - `packages/domain/src/installation.ts` importa sólo `./errors`, `./types`, `./projectLifecycle` (sin react/fs/xlsx); entidades `readonly`; errores `ValidationError` (subclase de `DomainError`); status del job **derivado**, nunca almacenado.
  - UI no calcula dominio: `InstallationJobPanel` lee exclusivamente `installationJobCardView` (que llama a funciones puras de `@muebles/domain`); sin fs/xlsx/electron.
  - Storage son adapters: mappers snake_case sin reglas; `CloseoutGateError` transporta checks estructurados, sin decisiones de presentación.
  - Sin `console.log` en archivos nuevos.
- C4: [x] Verificación real por capa: domain 26 tests de instalación (incluye contract fixture + balance punch en `deriveProjectStage`); storage 2 roundtrips instalación; ui 11 tests de comportamiento del panel (jsdom, getByLabelText, gates); Go: parity fixture + transiciones + gates OC-074 + RBAC + smuggling + hito.
- C5: [x] Sin archivos sin trackear sospechosos; `feature_list.json` refleja F137 `in_progress` (correcto hasta aprobación). El cierre de sesión (history/plantilla limpia) queda para después de esta review.

## Puntos específicos pedidos — todos verificados

1. **Boundaries**: OK (detalle en C3).
2. **Paridad TS↔Go**: `contracts/installationStatuses.json` es leído por AMBOS lados — `packages/domain/src/installation.test.ts` (import directo del fixture) y `backend-go/internal/domain/installationParity_test.go` (`os.ReadFile` + assertSetParity bidireccional). Reglas duplicadas (transiciones de visita/incidencia/punch, gates, units summary legacy fallback, derive status) tienen tests espejo TS↔Go equivalentes.
3. **OC-074**: triple defensa verificada —
   - PUT agregado del proyecto: `handlers.go` fuerza `p.Installation = existing.Installation` **y** el `UPDATE projects` de `UpdateProject` no incluye la columna `installation` (doble anti-smuggling);
   - `POST /api/projects/{id}/events` y el dual-write del agregado (`authorizeCloseoutEventAppends`) rechazan `client_signed_off`/`project_closed` con 409 cuando fallan gates (`ValidateCloseoutEventAppend` contra estado almacenado);
   - `POST /installation/closeout` evalúa gates **dentro** de `MutateProjectInstallation` (SELECT … FOR UPDATE) contra estado lockeado; el PUT de instalación rechaza closeout smuggleado con 409 (`closeoutFactsEqual`). `complete_installation` es hito auditable y NO cierra el proyecto. Tests cubren cada camino.
4. **RBAC**: matriz de eventos (`rbac.ts` L625–631): `installation_started/completed` incluye `produccion`; `punch_*`, `client_signed_off`, `project_closed` = admin/gerentes. El PUT deriva `punch_opened/punch_closed` del diff y devuelve 403 si el rol no puede appendearlos (`TestInstallation_PutPunchEventsRequirePunchRoles`); closeout con RBAC por acción (`produccion` puede `complete_installation`, no `sign_off`/`close`).
5. **Regla física**: instalación trabaja unidades/visitas (`moduleUnits` físico primero, fallback legacy etiquetado `mode`); sin mezclar status comercial/stage/ejecución; punch balance alimenta `deriveProjectStage` sin hackear el evento único.
6. **Migración 000070**: aditiva (`ADD COLUMN IF NOT EXISTS installation JSONB`) con down reversible; sin SQL destructivo; lectura lossless en GET.

## Diseño UI/UX

- D1: [x] Tokens en el CSS nuevo de `production.css` (sólo `var(--*)`; los fallbacks `var(--radius-md, 8px)` y dot 18px tienen precedente en `sectorAssignment.css`/`sales.css`). 0 hex.
- D2: [x] Patrón board por obra (`.ship-board__*` compartido con Embarques) + panel de trabajo por obra; unidad de trabajo correcta (visita + unidad, §3 operational-ux).
- D3: [x] Sin modales nuevos (inline forms dentro del panel — progresivo, consistente con el board).
- D4: [x] Toasts top-right 4s del sistema; éxitos con sujeto+verbo en modo API; el patrón de error `err.message` es el establecido del shell.
- D5: [x] Sólo Lucide con `strokeWidth={1.5}` (`CalendarDays`, `TriangleAlert`, `ListChecks`, `ClipboardCheck`) y **filas nuevas agregadas a design.md §3.7** como exige la regla.
- D6: [x] No se agregaron animaciones nuevas (sin movimiento nuevo que wrappear).
- D7: [ ] DoD §8 con 2 ítems fallando (ver Cambios requeridos 1–2): copy sentence case y formato de fechas §7.2.
- D8: [ ] Copy/datos: gates deshabilitados explican cómo resolverse (title con `details` + lista de gates siempre visible — excelente, §2.4 operational-ux); aria-labels en inputs/selects de formularios inline; una primaria por fila/contexto (patrón del board preexistente); PERO los botones secundarios «volver» están en minúscula (4 instancias) y las fechas de visita/límite se muestran ISO crudo.

## Cambios requeridos

1. **«volver» → «Volver»** (sentence case, design.md §7.1) en
   `packages/ui/src/production/InstallationJobPanel.tsx` líneas 216, 272, 418 y 503.
2. **Fechas en formato humano** `d MMM yyyy` es-MX (design.md §7.2) para `visit.date`
   (línea 146) y `punch.dueDate` («límite …», línea 376); hoy se renderizan ISO crudo
   (`2026-09-02`). El `closedAt` del closeout ya está bien formateado — replicar ese
   patrón (`toLocaleDateString('es-MX')`).
3. **Accidente de formato en línea ajena a la feature**:
   `apps/web/src/AppContent.tsx` línea 1748 — `try {      const activity = …` quedó en
   una sola línea (válido JS, no rompe nada, pero viola el formato Prettier del repo y
   toca `handleFabricClaim` sin razón). Restaurar el salto de línea.

Recomendado (no bloqueante, para una pasada de polish futura):

4. El badge del status del job usa siempre `status-badge--open` (azul) para
   Planificada/En curso/Completada; mapear a `--open/--progress/--done`.
5. Toast local «✓ Registrado» (modo guest) sin sujeto — alinearlo con
   «✓ Conformidad registrada» / «✓ Proyecto cerrado» del modo API.

## Nota final

El núcleo funcional (dominio, paridad, gates server-authoritative, RBAC, migración,
tests de las 4 capas) está impecable y verificado en verde por este revisor. Los tres
cambios pedidos son de copy/formato y de riesgo nulo; con ellos aplicados y suites
nuevamente verdes, la feature aprueba sin necesidad de otra pasada de review profunda.
