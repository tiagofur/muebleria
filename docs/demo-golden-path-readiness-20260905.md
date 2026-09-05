# Granete Demo Golden Path Readiness — 2026-09-05

Regresión superficial orientada exclusivamente a demo. No es una auditoría 360°.
Clasificación de findings históricos ejecutando sus proofs originales contra `main`
actual, no por lectura de código.

## Audited SHA

- main: `587961fd379b64cc27288d8de1a1118b50032a23` (clean, `--ff-only` con `origin/main`)
- date: 2026-09-05
- Contiene merges de #559 (`613fbb6c`) y #562 (`d6f5332e`) (#466/#467) y #564 (#563 device enrollment).
- Snapshot auditado por la auditoría 360: `316df57c` — todo finding histórico fue re-ejecutado, no heredado.

## Executive verdict

- **DEMO READY: SÍ** para el golden path SketchUp-céntrico (ventas → FurnitureInstance → diseño → SketchUp → preflight → release → BOM → producción), con mitigaciones de guion menores. El camino funcional completo está probado sobre Postgres/Go reales en este SHA.
- **PRIMARY GAP:** superficies React #500/#501/#502. El backend es completo y verde; la web no puede aún contar visualmente la historia del Digital Thread (matriz de unidades, historial de revisiones, reconciliation/requote/approval). ProductionRelease ya tiene modal.
- **DEMO BLOCKERS: 0** duros. Tres riesgos de guion con mitigación trivial (ver abajo).
- **POST-DEMO MVP ITEMS:** DXF rotado, order-dependence del resolver TS de drilling, provenance stripped en export de drilling, picking sin movimiento compensatorio, template roundtrip, Proyectar responsive móvil, library authoring UX.

## Golden Path

| Area | Status | Evidence | Blocker? | Next action |
|---|---|---|---|---|
| Foundation | **GREEN** | `scripts/organization-browser-gate.sh`: 17/17 PASS (Chromium+Go+Postgres efímero, 48.9s); `TestAuthDevices_*` (incl. migración RLS #560) y `TestAuthMFA_*` PASS | No | — |
| Sales / Quote | **GREEN** | `TestDigitalThreadE2E_ScenarioA_QuoteFirst`; `TestLogin_MultiMembershipRequiresSelection`/`TestSelectOrg_*` PASS | No | — |
| FurnitureInstance | **GREEN** | `ScenarioB_QuantityGreaterThanOne` (qty 3→3 identidades distintas); `TestQuoteLineFurniture_MaterializationLifecycleAndAudit` (4→2, sin reciclaje de IDs) PASS | No | — |
| Digital Thread | **GREEN** | `digital_thread_e2e_test.go` **9/9 PASS** sobre Postgres dedicado (A–G + negativos + fingerprint parity; release inmutable, stale base rechazada) | No | — |
| SketchUp binding | **GREEN** | Evidencia real-host comprometida `progress/host_smoke_F211_testup_ci.json` (3/3: placement, duplicate detection, persistence save/reopen) + `TestDesigns_ModelBindingContext` PASS | No | — |
| SketchUp furniture placement | **GREEN** | F211 (host) + `TC_ProjectFurnitureSmoke` suite existe | No | — |
| Shelf authoring (#467) | **GREEN** | `progress/host_smoke_467_testup_ci.json` **5/5** (move+undo, add, remove con dependencias, duplicate, structural rejected) capturado post-#562 (2026-09-05T17:34Z) | No | — |
| Hardware authoring (#468) | **GREEN** (host parcial) | Go: `TestAuthoringResolveHoleCollisionBetweenHingeAndShelfBlocksPreflight` PASS; golden API 05/06 PASS; host: 559 cubre navegación hardware; `TC_HardwareAuthoringSmoke` sin evidencia fresca comprometida | No | Añadir TC al `testup-ci.yml` en rehearsal |
| Manufacturing overlay (#470) | **GREEN** | `progress/host_smoke_558_testup_ci.json` **5/5** (draw/pick, rota con pieza, sigue a pieza movida, navigate-to-source hinge+shelf, toggle off 0 mutación) | No | — |
| Preflight (#466) | **GREEN** | `progress/host_smoke_559_testup_ci.json` **5/5** (blocked review + publish gate, rescue loop a ready, navegación al problema, stale locator, unreachable nunca ready) | No | — |
| WOW scenario | **GREEN** (path B con caveat) | Motor Go: conflicto hinge↔shelf → `DRILLING_CONFLICT` blocked → mover hinge → clear con machining de shelf intacto (PASS); golden 17/18 PASS; host 558/559 cubren conflicto+navegación+rescue. **No existe un único test end-to-end del path B (mover shelf limpia conflicto)** | No (riesgo de ensayo) | Ensayar path B en host; opcionalmente sumar escenario al TestUp |
| BOM / Engineering | **GREEN** (con caveat) | `EngineeringWorkspace*` tests PASS; despiece/herrajes/documentos con tests; `pnpm test` 411/411 web + packages verde. Caveat: documentos de drilling usan resolver TS con FM-03 (ver findings) | No | Guion demo con dims uniformes |
| Warehouse | **GREEN** | `WarehouseDashboard`, `StockPanel` con tests PASS. Bug picking sólo en failure-path (ver findings) | No | — |
| Production / Cutting / CNC | **GREEN** | `FabricScreen`, `ProductionOrderHub` (tabs) + tests PASS; exports drilling vía TS (mismo caveat FM-03) | No | — |
| Assembly | **GREEN** | Screens + tests (`ProductionWorkspace` et al.) PASS | No | — |
| Installation | **GREEN** | `InstalacionesScreen`/`InstalacionesProjectDetail`/`InstallationJobPanel` + tests PASS | No | — |
| DXF | **STILL_REPRODUCIBLE** | Rerun del harness: pieza rotada pierde el hole (0 CIRCLE vs 1); salida byte-idéntica a evidencia de auditoría; `dxfCutPlanExport.ts` sin cambios desde `316df57c` | No si el guion no muestra DXF rotado | POST-DEMO P0 |
| PTX / machine | **STRUCTURALLY READY / FIELD VALIDATION REQUIRED** | `ptxCutPlanExport.ts` + 6 tests + wrapper web PASS; 0 claims de máquina; #348 hard-block de field validation | No | No claim "machine validated" |
| React #500 | Backend COMPLETE / React MISSING | API + storage + cliente generado listos; **cero consumidores UI** de `listProjectFurnitureInstances` | Demo-degrading (MUST) | Implementar #500 |
| React #501 | Backend COMPLETE / React MISSING | `designs.go`/`design_publish.go` completos; **cero consumidores UI** de revisions/artifacts | Demo-degrading (MUST) | Implementar #501 |
| React #502 | Backend COMPLETE / React PARTIAL | `ProductionReleaseModal` existe (6 gates, fingerprint, revocar); **reconciliation y requote sin UI**; approval de revisions sin UI | Demo-degrading (MUST) | Implementar #502 |
| Library authoring UX | OBSERVACIÓN | Editores completos (modules/structures/components/agregados/catálogos) con tests; sin pantalla unificada de parámetros/bindings (#497); flujo de alta vía rutas `/edit` multi-panel | No | POST-DEMO MVP UX |

## Historical audit findings

| Finding | Current result | Evidence | Priority |
|---|---|---|---|
| Rotated DXF pierde perforación | **STILL_REPRODUCIBLE** — archivo sin cambios desde `316df57c`; rerun: 1 hole input → 0 CIRCLE rotado, byte-idéntico al evidence de auditoría | `pnpm exec vitest` sobre harness adaptado (7/7 repro) | POST-DEMO **P0** (demo: no exportar DXF con piezas rotadas; pieza sin rotar es correcta) |
| Drilling context/owner order (FM-03) | **STILL_REPRODUCIBLE** en resolver TS (`resolveProjectDrilling`: combinado ≠ independiente, order-dependent, 2 vs 3 hinge cups) — **no afecta** la ruta SketchUp/preflight: el resolve autoritativo es Go (`authoring_machining.go`) y está verde | Harness FM-03 rerun (repro); `TestAuthoringResolve*` PASS | POST-DEMO **P1**. Mitigación demo: líneas con dims uniformes o una sola línea por orden mostrada |
| Drilling provenance stripped (7 flags perdidos en export) | **STILL_REPRODUCIBLE** — export payload sin `fallbackUsed`/`issues` | Harness defect-proofs rerun | POST-DEMO **P1** |
| Template/library roundtrip (FM-01) | **STILL_REPRODUCIBLE** — 6 campos de kitchenLayout multi-ambiente perdidos en roundtrip | Harness FM-01 rerun (3/3 repro) | POST-DEMO MVP. No bloquea biblioteca demo: el seed trae MOD-GAB-01/MOD-CAJ-01/MOD-COMP-001; no usar templates multi-ambiente en demo |
| Proyectar responsive (canvas height 0 a 390/768) | **NEEDS_MANUAL_VERIFICATION** — CSS sin cambios desde antes de la auditoría (`b71f43cf`, ago-25), ningún commit lo addressa, sin tests a esos viewports; reproducción esperada | `git log -S "min-height: 50vh"`; inventario preview3d | POST-DEMO (no está en el guion SketchUp-céntrico; si se muestra, sólo desktop) |
| Picking 10→8→6 sin compensación (bonus) | **STILL_REPRODUCIBLE** — store-level, sólo failure-path | Harness defect-proofs rerun | POST-DEMO **P1** |

## Demo Blockers

**0.** Ningún defecto reproducido bloquea el golden path del demo si el guion aplica estas mitigaciones:

1. DXF: mostrar sólo piezas sin rotar (o postergar DXF).
2. Documentos de drilling/despiece en Operational Core: demo con dims uniformes por módulo (evita el cache-key collision de FM-03).
3. WOW path B (mover shelf limpia el conflicto): ensayarlo en host antes del demo; el path A (mover hinge) está probado end-to-end.

## Demo Freeze / Explicit Deferrals

No hacer antes del demo:

- Library UX redesign (editores actuales son suficientes con el seed).
- #469, #471, #474 full, #497 (parameters/bindings UI), #499, #503 sin machine evidence, #506.
- Sales Network amplio.
- Proyectar responsive/redesign (sólo desktop si se muestra).
- Cleanup/refactors generales; fixes de los findings POST-DEMO de la tabla anterior.

## Demo library readiness (seed existente — congelar, no crear)

| definitionId | Mueble | Parameters | Herrajes | Relationships/machining | Authorable internals | demo-safe |
|---|---|---|---|---|---|---|
| `MOD-GAB-01` | Gabinete 1 puerta 300×720×590 | presets multi-ancho (H09) | Bisagra Cierre Lento (con machining) | Drilling de puerta en despiece | Sí (Fluent en fixture plantillaDemo, base de todos los proofs) | **YES** |
| `MOD-CAJ-01` | Cajonera 4 cajones 500×720×590 | — | Corredera Telescópica 500mm | — | Sí | **YES** |
| `MOD-COMP-001` | Gabinete Compuesto 600 (estructura + puerta + 2 entrepaños regulables) | presets 300/400/600; role-based materials (FRENTE/INTERIOR/FONDO/BISAGRA/CORREDERA) | Bisagra + corredera | Structure body compartido; candidato WOW (entrepaño ↔ bisagra) | Sí (estructura→componentes por módulo) | **YES** |

Cobertura demo target: base 1 puerta ✓, cajonera ✓, gabinete con repisa móvil ✓ (WOW), zoclo ✓ (módulos plinth seedeados). Upper/tall cabinet: clonar variante de MOD-COMP-001 si hace falta — POST-DEMO.

## Recommended Execution Order

1. ~~Verificar main actual~~ — hecho en este pass (`587961fd`, todo verde).
2. Congelar biblioteca demo (los 3 seed definitions + datos demo `Demo plantilla`).
3. **#500** Project Furniture matrix (next implementation).
4. **#501** DesignRevision history/artifacts.
5. **#502** Reconciliation/Requote/Approval (completar sobre el modal existente).
6. Operational Core happy-path fixes: ninguno identificado como bloqueante; sólo rehearsal.
7. Verificación DXF (fix rotated holes → POST-DEMO P0).
8. Demo rehearsal: añadir `TC_HardwareAuthoringSmoke` + escenario WOW path B al `testup-ci.yml` y capturar evidencia host fresca.

## Verification executed in this pass

- Harness audit proofs (adaptado sólo en paths) contra `587961fd`: **7/7 repro** (DXF rotado, provenance, picking, FM-03, FM-01) — pasan = defecto reproduce.
- `go test`: Digital Thread E2E 9/9; QuoteLineFurniture 3/3; AuthDevices 4/4; AuthMFA 9/9; engine `TestAuthoringResolve*`; API golden/devices/login/org — **todo PASS** sobre Postgres efímero dedicado (`127.0.0.1:5599`, destruido; nunca se tocó el 5445 compartido).
- `pnpm typecheck` OK; `pnpm openapi:check` OK; `pnpm test` exit 0 (apps/web 411/411 + packages).
- `scripts/organization-browser-gate.sh`: **17/17 PASS**.
- SketchUp real host: NO ejecutado por este agente (sin host). Evidencia comprometida en `progress/host_smoke_{467,558,559,F498,F211}_testup_ci.json` (2026-09-04/05, 0 fails, 0 skips) = **REAL HOST EVIDENCE PRESENT** en ancestros de este SHA; no TESTUP EXECUTED BY THIS SESSION.
