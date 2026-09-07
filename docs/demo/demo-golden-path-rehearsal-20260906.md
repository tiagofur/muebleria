# Granete Demo Golden Path Rehearsal

Fecha: 2026-09-06 (America/Mexico_City). Post-#502 (PR #569). Rehearsal + audit +
evidence; sin implementación de features. Predecesores:
`docs/demo-golden-path-readiness-20260905.md` (regresión 09-05) y
`docs/demo-mvp-plan-2026-09-05.md` (plan DEMO→MVP).

## Executive verdict

`DEMO READY: YES WITH MITIGATIONS` — **condicional al guion**.

- El recorrido completo se puede **contar y ejecutar** con: fixture pre-sembrado
  (Q1 accepted + unidades físicas), handoff Web→SketchUp manual explícito, y
  **doble liberación** (canónica #502 + legacy) para el tramo operacional —
  donde la continuación es **legacy**: demuestra que la obra sigue operable,
  **no** que el BOM/operaciones deriven del snapshot exacto Q2+R2 de P1
  (ver Manufacturing verdict).
- El clímax comercial — *cliente acepta la Q2 en vivo → aprobar → liberar* —
  **no puede ejecutarse por un usuario** hoy: no existe superficie HTTP/UI para
  crear/publicar/aceptar una QuoteRevision. Si el guion exige ese momento en
  vivo, `DEMO READY: NO` hasta cerrar el P0-1.

## Base

- SHA: `main@79f45b281997d14d11c05b9ec5a93de97cfdead0` (clean, `--ff-only`)
- date: 2026-09-06
- PRs: #565 (#500), #568 (#501), #569 (#502) fusionados y verificados
- CI de main: run del merge #569 **success** (11m41s); previos verde
- Environment: macOS darwin 25.6.0 arm64; Docker corriendo; Node ≥20, pnpm 11
- Web: Vite dev (gate) + Chromium real (Playwright 1.61)
- Backend: `go run ./cmd/server` + PostgreSQL 16 efímero (contenedor dedicado,
  rol app `NOBYPASSRLS`)
- SketchUp/TestUp availability: **host real disponible y usado**
  (SketchUp 2026.2 + TestUp 2.5.4, RBZ instalado, `KeepOpen: false`)

## Golden path result

| Step | Result | Evidence | Demo impact | Mitigation |
|---|---|---|---|---|
| 1 Obra cocina (3 muebles, qty>1) | PASS | E2E #500: proyecto + QuoteLine qty=3 vía API/UI real; seed `MOD-GAB-01`/`MOD-CAJ-01`/`MOD-COMP-001` existe (`storage/seed.go`) | — | — |
| 2 Cotización (items, precios, total, estado) | PASS | `POST /projects/{id}/calculate` + ProjectsScreen/ProjectDetailView con tests; "Enviar cotización (legacy)" diferenciado; creación de Q1 integrada | — | — |
| A — ¿Q1 create→accept sin DB? (QUESTION A) | PASS | Commercial revision lifecycle: PASS (#571). Endpoints `POST /quote-revisions`, `:publish`, `:accept`; UI en Reconciliación con creación de Q1, publicación y aceptación atómica | — | — |
| 3 Materialización QuoteLine→unidades | PASS backend / **FAIL UI (P1-1)** | `:materialize` idempotente (#386) verde en Go; **cero consumidores UI** (grep); E2E lo hace por API | Usuario no puede generar unidades desde Web | Sembrar en fixture; no cambiar qty en vivo |
| 3b Matriz de muebles #500 | PASS | Browser gate `project-furniture.spec.ts` ✓ (3 unidades, Unidad i de 3, placed/pending, drawer, aislamiento tenant) | — | — |
| 4 Crear Design + workspace #501 | PASS | `create-design-btn` en ProjectDesignsScreen; E2E #501 ✓ | Working copy read-only en Web (authoring sólo SketchUp) | Guion SketchUp-céntrico |
| 5/B — Handoff Web→SketchUp (QUESTION B) | FRICTION (P1-2) | Picker "Conectar modelo" (2 selects por nombre) + binding validado server-side (#388); sin copiar UUID; caliente ~30-60 s, frío ~1.5-3 min | Paso explicativo, no mágico | Pre-enrolar dispositivo + nombres únicos de design |
| 6 Authoring SketchUp (mueble/mover/params) | PASS | TestUp real-host **5/5, 48 assertions, 0F/0E/0S** sobre este SHA (2026-09-06T14:11:40Z): move+undo, add, duplicate identidad, structural rejected | — | — |
| 7 Herrajes 3D | PASS* funcional (P1-8 visual Web) | Plugin #468 (`update_hardware_placement`, `substitute_hardware`); Go: colisión hinge↔shelf bloquea preflight; persistencia por identidad semántica | Web muestra preview estática (PNG artifact), no herraje interactivo | Mostrar herrajes en SketchUp |
| 8 Perforaciones por herrajes | PASS (Go fresco; overlay*) | Resolve autoritativo Go (`authoring_machining.go`) verde en esta sesión; overlay #470 coincide (host 558: 5/5, evidencia previa vigente); defecto FM-03 sólo en resolver TS legacy de exports | — | Dims uniformes en documentos legacy |
| 9 Componentes internos (#467) | PASS | Host smoke 5/5 fresco (arriba); autoridad de topología server-side | — | — |
| 10 Preflight SketchUp (#466) | PASS* | Host 559 (5/5, evidencia previa vigente): blocked review, publish gate, rescue loop, stale locator, unreachable≠ready; Web usa el MISMO read model (#502) | — | — |
| 11 Publicar R1 | PASS por mitades (P1-4) | Endpoints publish probados (Go 9/9 E2E); plugin publisher probado contra fake — **sin prueba plugin↔backend real** | Riesgo de sorpresa en vivo | Ensayar publish real una vez pre-demo |
| 12 Web revisiones/artifacts #501 | PASS | E2E #501 ✓: linaje R1→R2, pinneo histórico, reload estable, hashes, grants firmados | — | — |
| 13 Cambio que requiere requote (R2) | PASS | E2E #502 ✓: width 600→650 → modified con impacto Comercial+Fabricación | — | — |
| 14 Reconciliation #502 | PASS | E2E #502 ✓: rows por `furnitureInstanceId`, diferencias estructuradas, summary server-owned | IDs técnicos visibles (aceptable) | — |
| 15 Requote → Q2 draft | PASS | `requoteProjectQuote` + modal review; Q1 intacta; VERSION_CONFLICT tipado probado | — | — |
| C — ¿Q2 draft→accepted desde Web? (QUESTION C) | PASS | Commercial revision lifecycle: PASS (#571). Publicación y aceptación atómica de Q2 (Q1 pasa a superseded en la misma tx) vía UI/API real sin SQL | — | — |
| 16 Q2↔R2 reconcile | PASS | E2E ✓: blockers comerciales resueltos, sin diferencias inesperadas (Q2 aceptada vía UI) | — | — |
| 17 Preflight Web (roles/redaction) | PASS | Panel #502 usa endpoint autoritativo; redacción por rol probada en Go | — | — |
| 18 Production approval | PASS | Comando siempre-gateado; negativo probado (Q draft → rechazo server-side); exige Q exacta+R exacta | — | — |
| 19 ProductionRelease P1 | PASS | E2E ✓: pins exactos Q2+R2, fingerprint `sha256-`, historial durable | — | — |
| 20 Durabilidad histórica (R3→P1 stale) | PASS | E2E ✓: P1 queda Stale pineado a R2; nunca retarget | — | — |
| 21 BOM | PARTIAL (P0-2) | MRP derive exige release authority y binda ReleaseID+fingerprint; **el contenido sale de `project.items`** (motor TS), no de R2 | "¿El BOM corresponde a P1/R2?" — hoy no exactamente | Declarar límite en guion |
| 22 Warehouse | PASS (legacy) | Stock/movimientos/reservas/picking/OC verdes con tests | — | — |
| 23 Production (corte→…→instalación) | PASS como continuación legacy (P0-2) | Part-executions + gates de revisión server-side; **UI bloqueada tras P1 canónico** (blob legacy null) | Doble liberación en guion; **no presentar como derivado de P1/R2** | EngineeringWorkspace → modal legacy |
| 24 Manufacturing outputs | PASS con límites | 13 documentos en ProductionOrderHub; PTX estructuralmente listo; sin claims de máquina | — | Sin claim "machine validated" |
| 25 DXF rotado | STILL_REPRODUCIBLE (sin cambios) | Archivo sin cambios desde `706135f7` (ago-26); repro ayer sobre `587961fd` | Evitable | `DEMO MITIGATION`: no exportar piezas rotadas |
| 26 FM-03 order-dependence TS | STILL_REPRODUCIBLE (sin cambios) | Resolver TS sin cambios desde `193beb4a` (ago-22); no toca ruta autoritativa Go | Evitable | Dims uniformes por módulo |
| 27 Performance/estabilidad | PASS | Tests E2E 2.7-12.4 s c/u; gate completo 40.3 s; sin crashes/hangs/retries raros observados | — | — |
| 28 UI/UX golden path | Ver P1 | Copy español, estados vacíos honestos, fail-closed; CTA por contexto | — | — |
| 29 Reset/repetibilidad | PARTIAL | `cmd/admin seed --org` (idempotente) + `clean-demo-data [--apply]`; helper E2E siembra Q1/unidades por SQL | Falta fixture demo documentado | Propuesta abajo (no framework) |
| 30 Offline/fallo de red | PASS (smoke) | Idempotency-Key durable, VERSION_CONFLICT tipado, failure-rollback spec (409 sin fila ni falso éxito) | — | — |
| 31 Roles (Admin/Sales) | PASS parcial | E2E owner + aislamiento org B; preflight redactado por rol (Go) | Store/Partner fuera de este flujo (Gate B) | — |
| 32 Consistencia Web↔SketchUp | PASS | Ambos consumen los mismos endpoints autoritativos; eco verbatim plugin; sin "dos verdades" | Publish real sin prueba cruzada (P1-4) | — |

> `PASS*` = por **evidencia previa vigente** del mismo código de extensión (sin
> cambios desde PR #564, `587961fd`); el único rehearsal host **fresco** de esta
> sesión fue `TC_ComponentAuthoringSmoke` (5/5). Rehearsal host fresco de
> hardware/preflight/overlay: pendiente (TC fuera del `testup-ci.yml`).

## P0 Demo Blockers

### P0-1 — Lifecycle comercial (QuoteRevision): Commercial revision lifecycle: PASS (#571)

- **Estado**: **PASS (RESUELTO en #571)**.
- **Solución implementada**:
  - Storage & DB: endpoints `CreateInitialQuoteRevision`, `PublishQuoteRevision`, `AcceptQuoteRevision` con transacción atómica, serialización/concurrencia, auditoría durable y constraint de unicidad (`000121_quote_revision_accepted_uniqueness`). La aceptación de Q2 pasa Q1 a `superseded` atómicamente en la misma transacción.
  - API & RBAC: `POST /projects/{id}/quote-revisions`, `POST /projects/{id}/quote-revisions/{quoteRevisionId}:publish`, `POST /projects/{id}/quote-revisions/{quoteRevisionId}:accept`, gobernados por `RoleCanAcceptQuoteRevisions`.
  - Web UI: Panel `QuoteLifecyclePanel` y modal `AcceptQuoteModal` en Reconciliación con estados de creación de Q1, publicación, aceptación atómica, histórico de revisiones y advertencia de superseding.
  - E2E: `tests/organization/project-reconciliation.spec.ts` corre el golden path completo (Q1 create → Q1 publish → Q1 accept → requote Q2 → Q2 publish → Q2 accept → approval → P1) **sin mutaciones directas de SQL**.
- **Nota**: P0-2 permanece abierto como siguiente hito.

### P0-2 — ProductionRelease canónico (P1) no habilita el tramo operacional en la Web (costura legacy)

- **Estado**: **PARTIAL / OPEN (#577 / OPS-DT-1; corrección acotada en PR #578)**.
- **Bloqueador pendiente**: el snapshot fija intención e identidades, pero el engine TS todavía consume catálogo industrial mutable (definiciones, componentes, herrajes, defaults y reglas). `definitionVersion` y parámetros no dimensionales no tienen cobertura completa. El fingerprint estampado no demuestra igualdad del BOM calculado; no declarar cierre ni certificación industrial.
- **Corrección acotada del PR**: autoridad newest coherente entre listado/detalle; lectura por release ID exacto; piezas/unidades de FurnitureInstance liberadas, sin cantidades/dimensiones de la cotización mutable. Gate Chromium + Go + PostgreSQL real: **4/4 PASS** después de modificar cantidad comercial a nueve y dimensiones a 999; suites completas TS/Go y typecheck PASS. El PR registra SHA/readback de publicación; estos proofs no resuelven el bloqueador de catálogo.
- **Solución implementada**:
  - Read model: `GET /api/projects` (list+detail) expone la proyección
    server-owned `resolved_production_release` (`source: canonical|legacy`,
    releaseId, releaseNumber, designRevisionId/Number, quoteRevisionId,
    fingerprint, status), computada con el resolver único
    (`ResolveProjectReleaseAuthority`); canónico gana SIEMPRE sobre el blob
    coexistente; redactada para sales callers; nunca aceptada en writes.
  - `canDerive` y los gates operacionales (part-executions, costing,
    overview, assembly readiness) consumen la proyección — no el blob.
  - `POST .../materials/derive` requiere `production_release_id` EXACTO
    cuando hay release canónico (409 implícito-latest; id ajeno → 409) y
    persiste proveniencia exacta (`source_release_number`,
    `source_design_revision_id/number`, `source_quote_revision_id` +
    fingerprint del release) en el snapshot de requirements y en el evento
    auditado.
  - El contenido del BOM/material planning se deriva del snapshot inmutable
    de la revisión pineada (adapter puro `releaseBomContext` en
    `@granete/domain` → engine TS existente; paridad probada por tests:
    mismas líneas que el estado quote equivalente, y `project.items` mutable
    no altera la derivación).
  - Part-executions: `'rev-1'` eliminado; piezas/unidades derivadas del
    snapshot del release y estampadas con el id exacto (el guard 409
    server-side se preserva).
  - `processStage` reconoce la authority canónica como envío a producción:
    P1 habilita almacén→producción sin "Enviar a producción" legacy (CTA
    oculto con canónico; badge `Liberación #1 · Diseño R2` en su lugar).
  - E2E real (React+Go+PostgreSQL, `project-reconciliation.spec.ts`):
    derive desde P1 con provenance `Liberación #1 · Diseño R2`, readback con
    pins exactos, negativos derive (implícito/ajeno 409 sin plan parcial),
    mutación de `project.items` sin efecto, producción reconoce la
    liberación + generación física estampada con el id exacto, y el blob
    legacy permanece **NULL** durante todo el path (sin doble liberación).
- **Nota**: límites documentados (fingerprint cubre revision items, no el
  contenido agregado de lines; quote revision items no pinean
  materialChoices hoy — el E2E operacional usa release design-first con
  choices material-pinned).

## P1 Demo Quality

1. **Materialización sin botón Web** (`:materialize` verde en API; sin consumidor UI).
   Mitigar con fixture; no cambiar cantidades en vivo.
2. **Handoff Web→SketchUp manual por nombre** (picker 2 dropdowns, caliente ~30-60 s,
   frío ~1.5-3 min con enrollment). Sin copiar UUID; binding validado por el servidor.
   #499 lo convierte en WOW; hoy es explicación de 1 frase.
3. **Enrollment de dispositivo + MFA step-up en vivo es frágil** (código 6 chars TTL
   10 min; requiere TOTP habilitado). Pre-enrolar el dispositivo y mantener sesión web
   abierta antes del demo.
4. **Publish plugin→backend real sin prueba automatizada** (Go 9/9 + plugin vs fake,
   por separado). Ensayar una publicación real completa pre-demo y capturar evidencia.
5. **`testup-ci.yml` sólo corre `TC_ComponentAuthoringSmoke`**: añadir
   `TC_HardwareAuthoringSmoke` y el escenario WOW path B (mover shelf limpia conflicto)
   — ya recomendado por el readiness 09-05.
6. **Trampa UX de doble modelo comercial**: "Aceptar cotización" (legacy) parece
   cubrir Q1 pero no toca `quote_revisions`. Se resuelve con P0-1; mientras tanto,
   guion explícito.
7. **Web sin autoría del working copy** (Diseños es lectura; authoring vive en
   SketchUp). Aceptable para guion SketchUp-céntrico; exige cambio de app fluido.
8. **Hardware visual en Web = preview estática** (PNG del artifact publicado); el
   herraje interactivo/overlay vive en SketchUp. VISUAL POLISH, no funcional.
9. **DXF rotado pierde perforación** (sin cambios de código desde el último repro;
   POST-DEMO P0 del readiness). `DEMO MITIGATION`: no exportar piezas rotadas.
10. **Sin entidad machine profiles** (`machine_id` texto libre; PTX "estructuralmente
    listo, validación de campo pendiente"). No claims de máquina en el demo.

## Post-demo (resumen por área)

- Resolver TS legacy: FM-03 order-dependence, provenance stripping en export de
  drilling, picking sin movimiento compensatorio, template roundtrip FM-01.
- Proyectar responsive móvil; library authoring UX (#497).
- #503 machine evidence; SCM post-procesador nativo (F132 diferido).
- SEC-8/9 y Gate B (#462) para Red de Ventas/Store-Partner.

## Web↔SketchUp verdict

- **Current path**: Web (obra/diseño creado) → SketchUp: abrir panel Granete →
  Estado → "Conectar modelo" → seleccionar Proyecto y Diseño **por nombre** →
  Conectar (validación autoritativa `binding:validate` + escritura post-validación
  en diccionario del modelo). Device enrollment (código 6 chars aprobado en
  `/devices` con MFA) sólo la primera vez; secreto en Keychain, bearer 15 min.
- **Friction**: FRICTION (no blocker). Caliente ~30-60 s; riesgo de design
  equivocado acotado con nombres únicos; stale_base se muestra explícito.
- **#499 priority**: `#499 AFTER <commercial lifecycle P0-1>` — mejora el WOW pero
  no desbloquea la historia; el clímax comercial está bloqueado por P0-1.

## Quote lifecycle verdict

> **Actualizado tras #571 (2026-09-06, post-rehearsal)**: el P0-1 fue cerrado —
> ver la sección P0-1 de arriba. El verdict original del rehearsal se conserva
> como evidencia histórica.

- Q1 create/publish/accept: **NO disponible por HTTP/UI** (sólo requote existe)
  — *hallazgo original; RESUELTO en #571*.
- Q2 accept: **NO disponible** (E2E usa SQL por rol migration) — *hallazgo
  original; RESUELTO en #571 (E2E sin SQL lifecycle mutations)*.
- Demo viability: contable con fixture; **no ejecutable en vivo** el momento de
  aceptación del cliente — *hallazgo original*. Estado actual:
  `COMMERCIAL REVISION LIFECYCLE DEMO READY: YES (#571)`.
- Next action: issue S (P0-1) — *ejecutada como #571*.

## Hardware verdict

- Web visual: DEGRADED (preview estática del artifact; sin herraje interactivo).
- SketchUp visual: PASS (placement, sustitución, overlay #470 con navegación).
- Placement/persistencia: PASS (identidad semántica; no geometría arbitraria).
- Drilling: PASS (resolve autoritativo Go; dueño correcto; sin ghost holes en la
  ruta autoritativa — el defecto TS es sólo de exports legacy).
- BOM inclusion: PASS en la ruta legacy (hardware list); el BOM canónico desde R2
  no existe (P0-2 related).
- `HARDWARE DEMO READY: YES` (funcional) **por evidencia previa vigente** del
  mismo código (sin cambios desde PR #564); **rehearsal host fresco pendiente**
  (`TC_HardwareAuthoringSmoke` fuera del CI yml) y VISUAL POLISH pendiente en Web.

## Manufacturing verdict

- Preflight: PASS (autoritativo, mismo read model Web/plugin; blocked controlado).
- Release: PASS (pins exactos, fingerprint, durabilidad histórica).
- BOM: PARTIAL (contenido desde `project.items`, no desde R2/P1; MRP binda release).
- Warehouse: PASS (legacy path completo y testeado).
- Production: PASS (legacy path completo; UI bloqueada tras P1 canónico → P0-2).
- Outputs: PASS con límites (cut list CSV configurable, optimizer XLSX, PDFs,
  etiquetas ZPL, DXF, PTX, drilling, CNC pilot JSON; 13 docs descargables).
  Sin claims de máquina; DXF rotado mitigado por guion.
- `PRODUCTION FLOW DEMO READY: YES AS LEGACY DEMO CONTINUATION, NOT YET AS
  END-TO-END CANONICAL DIGITAL THREAD`. La doble liberación sólo permite
  **abrir/continuar el flujo operativo legacy**; **no** prueba que el
  BOM/operaciones deriven del snapshot exacto Q2+R2 de P1:

```text
P1 canonical (Q2+R2, #502)
     ↓
Digital Thread exactness (revisiones/approval/release/pins) ✅

legacy operational continuation (doble liberación)
     ↓
BOM / warehouse / production ✅ demoable

exact provenance to P1/R2 ❌ not yet proven
```

  No presentar al cliente que "la producción deriva exactamente de P1/R2"
  hasta cerrar P0-2.

## Known mitigations

- No exportar DXF con piezas rotadas (defecto reproducible).
- Documentos de drilling/despiece con dims uniformes por módulo (FM-03).
- No usar templates multi-ambiente (FM-01 roundtrip).
- Fixture pre-demo: org demo + seed library + Q1 accepted + unidades materializadas
  (+ aceptación de Q2 si el guion la necesita "ya hecha").
- Handoff manual explícito Web→SketchUp (nombres únicos de diseño).
- Pre-enrolar dispositivo SketchUp y sesión web antes del demo.
- Doble liberación (canónica + legacy) para el tramo operacional — la
  continuación es legacy: **no afirmar provenancia exacta P1/R2 → BOM**.
- Sin claim de compatibilidad con máquinas (PTX/DXF "salida preparada, validación
  pendiente").

## Demo reset / repeatability (STEP 29)

Existente y suficiente (no construir framework):

1. `go run ./cmd/admin create-org <slug>` + `go run ./cmd/admin seed --org <slug>`
   (idempotente: MOD-GAB-01, MOD-CAJ-01, MOD-COMP-001, bajos, materiales, herrajes
   F127, clientes plantilla, proyecto demo).
2. `go run ./cmd/admin clean-demo-data [--apply] [--org <slug>]` (dry-run por
   default) para resetear entre ensayos.
3. El helper del E2E (`tests/organization/project-reconciliation.spec.ts`) ya sabe
   sembrar Q1 accepted + unidades por SQL migración: **promoverlo a un pequeño
   `demo fixture` documentado** (script o subcomando admin) — no una seed framework.

Propuesta mínima: documento `docs/demo/demo-script.md` + script `scripts/demo-reset.sh`
que orqueste (1)+(2)+fixture comercial. Implementar después de P0-1 para no duplicar.

## Recommended next issue

`NEXT: NEW ISSUE (child de #396) — Commercial revision lifecycle API + Web: create/publish/accept QuoteRevision (Q1) y aceptación de requote (Q2)`

Por qué gana sobre #499/#503/otros: es el único gap que **impide ejecutar en vivo el
clímax del demo** (cliente acepta Q2 → aprobar → liberar; los gates server-side
rechazan sin Q accepted). El storage y el lifecycle ya existen (migrations
000115-000117 + `UpdateQuoteRevisionStatus` probado); el trabajo es handler + OpenAPI
generado + UI (patrón del comando de aprobación #502). Scope S, riesgo bajo, y
elimina además la trampa UX del botón legacy "Aceptar cotización". #499 suma WOW pero
la fricción actual es mitigable con guion; #503 requiere datos de campo.

## Subsequent order

1. Commercial revision lifecycle API+Web (P0-1, S).
2. Demo fixture/reset mínimo (`demo-reset.sh` + guion documentado; promote del helper
   E2E) — asegura ensayo repetible esta semana.
3. Continuidad P1→ops en Web (P0-2, S-M): exponer release canónico y reemplazar
   canDerive/derivación legacy.
4. #499 handoff exacto Web→SketchUp (WOW; base: binding #388 + enrollment listos).
5. Endurecimiento de evidencia host: `testup-ci.yml` +`TC_HardwareAuthoringSmoke`
   +WOW path B; un ensayo grabado plugin↔backend-real de publish R1.

## Verification executed

- `pnpm openapi:check`: sin drift ✓
- `pnpm typecheck`: 7/7 proyectos ✓
- `pnpm test`: exit 0 (apps/web 424/424; packages verde)
- `GOFLAGS='-p=1' go test ./... -count=1`: 11/11 packages `ok` (incl.
  `internal/storage` 252 s y `tests/pilotreadiness` 245 s sobre PostgreSQL real)
- Browser: `scripts/organization-browser-gate.sh` con specs #500/#501/#502 →
  **5/5 PASS, 40.3 s** (Chromium + Go + PostgreSQL 16 efímero, roles separados)
- SketchUp/TestUp real host (este SHA): `TC_ComponentAuthoringSmoke`
  **Success 5/5, 48 assertions, 0F/0E/0S** (`progress/host_smoke_467_testup_ci.json`,
  2026-09-06T14:11:40Z). Evidencia adicional comprometida de días previos (mismo
  código de extensión, sin cambios desde PR #564): overlay 558 5/5, preflight 559 5/5.
- Ruby unit/`rake verify` y publish plugin↔backend-real: NO ejecutados en esta sesión
  (host smoke es el subconjunto CI configurado); ver P1-4/P1-5.
